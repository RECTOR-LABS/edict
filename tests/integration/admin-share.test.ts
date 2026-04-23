/**
 * Integration tests for scripts/admin-share.ts (runAdminShare CLI).
 *
 * Pattern matches share-actions.test.ts:
 * - Real DB via @testcontainers/postgresql
 * - DEV_PRINT_MAGIC_LINKS=true + no RESEND_API_KEY → sendMail dev-prints, no real sends
 * - Script does not use admin session context — adminId is passed explicitly as an arg,
 *   so no middleware or ALS mocking needed.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type { runAdminShare } from "@/scripts/admin-share";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let runShare: typeof runAdminShare | undefined;

beforeAll(async () => {
  pg = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("edict")
    .withUsername("edict_admin")
    .withPassword("test")
    .start();

  const bootstrap = new Pool({ connectionString: pg.getConnectionUri() });
  const names = (await readdir("./migrations")).filter((n) => n.endsWith(".sql")).sort();
  for (const n of names) await bootstrap.query(await readFile(join("./migrations", n), "utf8"));
  await bootstrap.end();

  // Dev-print mode: no Resend, no real emails, no rate-limit interactions.
  process.env.DEV_PRINT_MAGIC_LINKS = "true";
  delete process.env.RESEND_API_KEY;

  const host = pg.getHost();
  const port = pg.getMappedPort(5432);
  process.env.DATABASE_URL = `postgres://edict_app:dev@${host}:${port}/edict`;
  process.env.DATABASE_ADMIN_URL = pg.getConnectionUri();

  dbModule = await import("@/lib/db");
  ({ runAdminShare: runShare } = await import("@/scripts/admin-share"));
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

beforeEach(async () => {
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  await adminDb.delete(schema.auditLog);
  await adminDb.delete(schema.magicLinkTokens);
  await adminDb.delete(schema.sessions);
  await adminDb.delete(schema.docShares);
  await adminDb.delete(schema.clientMembers);
  await adminDb.delete(schema.docs);
  await adminDb.delete(schema.clients);
  await adminDb.delete(schema.admins);
});

async function seed() {
  const { adminDb, schema } = dbModule!;
  const [admin] = await adminDb
    .insert(schema.admins)
    .values({ email: "admin@edict.test", name: "Test Admin" })
    .returning();
  const [client] = await adminDb
    .insert(schema.clients)
    .values({ slug: "acme", name: "Acme Corp" })
    .returning();
  const [doc] = await adminDb
    .insert(schema.docs)
    .values({
      slug: "launch-plan",
      title: "Launch Plan",
      bodyType: "html",
      body: "<p>hello</p>",
      createdBy: admin!.id,
    })
    .returning();
  return { admin: admin!, client: client!, doc: doc! };
}

describe("runAdminShare", () => {
  it("dispatches magic-links to multiple recipients, creates share row, writes doc_shared audit", async () => {
    const { admin, client, doc } = await seed();
    const { adminDb } = dbModule!;

    const result = await runShare!({
      adminId: admin.id,
      clientId: client.id,
      docId: doc.id,
      emails: ["a@acme.test", "b@acme.test", "c@acme.test"],
    });

    expect(result.doc.id).toBe(doc.id);
    expect(result.client.id).toBe(client.id);
    expect(result.sent).toHaveLength(3);
    const dispatchedEmails = result.sent.map((s) => s.email).sort();
    expect(dispatchedEmails).toEqual(["a@acme.test", "b@acme.test", "c@acme.test"]);

    // 3 client_members rows (all viewers, all unrevoked).
    const members = await adminDb.query.clientMembers.findMany({});
    expect(members).toHaveLength(3);
    expect(members.every((m) => m.role === "viewer" && m.revokedAt === null)).toBe(true);

    // 1 doc_shares row.
    const shares = await adminDb.query.docShares.findMany({});
    expect(shares).toHaveLength(1);
    expect(shares[0]!.docId).toBe(doc.id);
    expect(shares[0]!.clientId).toBe(client.id);

    // 3 magic-link tokens, none yet consumed.
    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(3);
    expect(tokens.every((t) => t.consumedAt === null)).toBe(true);

    // 3 magic_link_sent + 1 doc_shared audit rows.
    const audits = await adminDb.query.auditLog.findMany({
      orderBy: (a, { asc }) => [asc(a.createdAt)],
    });
    const sent = audits.filter((a) => a.eventType === "magic_link_sent");
    const shared = audits.filter((a) => a.eventType === "doc_shared");
    expect(sent).toHaveLength(3);
    expect(shared).toHaveLength(1);
    expect(shared[0]!.actorId).toBe(admin.id);
    expect(shared[0]!.clientId).toBe(client.id);
    expect(shared[0]!.docId).toBe(doc.id);
  });

  it("throws when doc not found", async () => {
    const { admin, client } = await seed();
    await expect(
      runShare!({
        adminId: admin.id,
        clientId: client.id,
        docId: "00000000-0000-0000-0000-000000000000",
        emails: ["a@acme.test"],
      }),
    ).rejects.toThrow(/doc not found/);
  });

  it("throws when client not found", async () => {
    const { admin, doc } = await seed();
    await expect(
      runShare!({
        adminId: admin.id,
        clientId: "00000000-0000-0000-0000-000000000000",
        docId: doc.id,
        emails: ["a@acme.test"],
      }),
    ).rejects.toThrow(/client not found/);
  });

  it("throws when admin not found", async () => {
    const { client, doc } = await seed();
    await expect(
      runShare!({
        adminId: "00000000-0000-0000-0000-000000000000",
        clientId: client.id,
        docId: doc.id,
        emails: ["a@acme.test"],
      }),
    ).rejects.toThrow(/admin not found/);
  });

  it("is idempotent — re-running with the same email reuses the existing client_member", async () => {
    const { admin, client, doc } = await seed();
    const { adminDb } = dbModule!;

    await runShare!({
      adminId: admin.id,
      clientId: client.id,
      docId: doc.id,
      emails: ["same@acme.test"],
    });

    const firstMembers = await adminDb.query.clientMembers.findMany({});
    expect(firstMembers).toHaveLength(1);

    await runShare!({
      adminId: admin.id,
      clientId: client.id,
      docId: doc.id,
      emails: ["same@acme.test"],
    });

    const secondMembers = await adminDb.query.clientMembers.findMany({});
    expect(secondMembers).toHaveLength(1);
    expect(secondMembers[0]!.id).toBe(firstMembers[0]!.id);

    // But each invocation issued a new magic-link token.
    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(2);
  });
});
