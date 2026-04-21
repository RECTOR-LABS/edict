import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type { listDocsForClientWithLastViewed } from "@/lib/db/queries/docs";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let queries: {
  listDocsForClientWithLastViewed: typeof listDocsForClientWithLastViewed;
};

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

  const host = pg.getHost();
  const port = pg.getMappedPort(5432);
  process.env.DATABASE_URL = `postgres://edict_app:dev@${host}:${port}/edict`;
  process.env.DATABASE_ADMIN_URL = pg.getConnectionUri();

  dbModule = await import("@/lib/db");
  queries = await import("@/lib/db/queries/docs");
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

// Truncate in FK-safe order before each test.
// auditLog → docShares → clientMembers → docs → clients → admins
beforeEach(async () => {
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  await adminDb.delete(schema.auditLog);
  await adminDb.delete(schema.docShares);
  await adminDb.delete(schema.clientMembers);
  await adminDb.delete(schema.docs);
  await adminDb.delete(schema.clients);
  await adminDb.delete(schema.admins);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAdmin(email = "admin@edict.test") {
  const { adminDb, schema } = dbModule!;
  const [row] = await adminDb
    .insert(schema.admins)
    .values({ email, name: "Test Admin" })
    .returning();
  if (!row) throw new Error("seed admin failed");
  return row;
}

async function seedClient(slug: string) {
  const { adminDb, schema } = dbModule!;
  const [row] = await adminDb
    .insert(schema.clients)
    .values({ slug, name: slug })
    .returning();
  if (!row) throw new Error("seed client failed");
  return row;
}

async function seedMember(clientId: string, email: string) {
  const { adminDb, schema } = dbModule!;
  const [row] = await adminDb
    .insert(schema.clientMembers)
    .values({ clientId, email, role: "viewer" })
    .returning();
  if (!row) throw new Error("seed member failed");
  return row;
}

async function seedDoc(
  createdBy: string,
  overrides: {
    slug?: string;
    title?: string;
    bodyType?: "html" | "markdown";
  } = {},
) {
  const { adminDb, schema } = dbModule!;
  const slug = overrides.slug ?? `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [row] = await adminDb
    .insert(schema.docs)
    .values({
      slug,
      title: overrides.title ?? "Test Doc",
      bodyType: overrides.bodyType ?? "html",
      body: "<p>test</p>",
      createdBy,
    })
    .returning();
  if (!row) throw new Error("seed doc failed");
  return row;
}

async function seedShare(
  docId: string,
  clientId: string,
  overrides: { sharedAt?: Date; revokedAt?: Date | null } = {},
) {
  const { adminDb, schema } = dbModule!;
  const [row] = await adminDb
    .insert(schema.docShares)
    .values({
      docId,
      clientId,
      sharedAt: overrides.sharedAt ?? new Date(),
      revokedAt: overrides.revokedAt ?? null,
    })
    .returning();
  if (!row) throw new Error("seed share failed");
  return row;
}

async function seedAuditDocViewed(opts: {
  actorId: string;
  docId: string;
  clientId: string;
  createdAt?: Date;
}) {
  const { adminDb, schema } = dbModule!;
  const [row] = await adminDb
    .insert(schema.auditLog)
    .values({
      eventType: "doc_viewed",
      actorType: "client_member",
      actorId: opts.actorId,
      docId: opts.docId,
      clientId: opts.clientId,
      metadata: {},
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  if (!row) throw new Error("seed audit event failed");
  return row;
}

// ---------------------------------------------------------------------------
// listDocsForClientWithLastViewed()
// ---------------------------------------------------------------------------

describe("listDocsForClientWithLastViewed()", () => {
  it("returns [] when client has no shared docs", async () => {
    const client = await seedClient("empty-client");
    const member = await seedMember(client.id, "user@edict.test");

    const rows = await queries.listDocsForClientWithLastViewed(client.id, member.id);
    expect(rows).toEqual([]);
  });

  it("returns 2 rows with lastViewedAt: null when docs are shared but never viewed", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("no-views-client");
    const member = await seedMember(client.id, "user@edict.test");

    const docA = await seedDoc(admin.id, { slug: "doc-a", title: "Doc A" });
    const docB = await seedDoc(admin.id, { slug: "doc-b", title: "Doc B" });

    await seedShare(docA.id, client.id);
    await seedShare(docB.id, client.id);

    const rows = await queries.listDocsForClientWithLastViewed(client.id, member.id);
    expect(rows).toHaveLength(2);

    // Both must have null lastViewedAt — never viewed.
    for (const row of rows) {
      expect(row.lastViewedAt).toBeNull();
    }
  });

  it("returns the correct lastViewedAt when the member has viewed a doc", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("viewed-client");
    const member = await seedMember(client.id, "reader@edict.test");

    const doc = await seedDoc(admin.id, { slug: "viewed-doc", title: "Viewed Doc" });
    await seedShare(doc.id, client.id);

    const viewedAt = new Date("2026-03-15T10:00:00Z");
    await seedAuditDocViewed({ actorId: member.id, docId: doc.id, clientId: client.id, createdAt: viewedAt });

    const rows = await queries.listDocsForClientWithLastViewed(client.id, member.id);
    expect(rows).toHaveLength(1);

    // lastViewedAt must match the seeded audit event's createdAt (within 1s for timestamp precision).
    expect(rows[0]!.lastViewedAt).not.toBeNull();
    expect(Math.abs(rows[0]!.lastViewedAt!.getTime() - viewedAt.getTime())).toBeLessThan(1_000);
  });

  it("does NOT surface another member's viewed state — each member's view is independent", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("per-member-isolation");
    const memberA = await seedMember(client.id, "a@edict.test");
    const memberB = await seedMember(client.id, "b@edict.test");

    const doc = await seedDoc(admin.id, { slug: "shared-doc", title: "Shared Doc" });
    await seedShare(doc.id, client.id);

    // Only member A has viewed the doc.
    await seedAuditDocViewed({
      actorId: memberA.id,
      docId: doc.id,
      clientId: client.id,
      createdAt: new Date("2026-03-15T12:00:00Z"),
    });

    // Query as member B — must see lastViewedAt: null.
    const rowsForB = await queries.listDocsForClientWithLastViewed(client.id, memberB.id);
    expect(rowsForB).toHaveLength(1);
    expect(rowsForB[0]!.lastViewedAt).toBeNull();

    // Query as member A — must see the viewed timestamp.
    const rowsForA = await queries.listDocsForClientWithLastViewed(client.id, memberA.id);
    expect(rowsForA).toHaveLength(1);
    expect(rowsForA[0]!.lastViewedAt).not.toBeNull();
  });

  it("excludes revoked shares — revoked docs are not returned", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("revoke-test");
    const member = await seedMember(client.id, "user@edict.test");

    const docActive = await seedDoc(admin.id, { slug: "active-doc", title: "Active Doc" });
    const docRevoked = await seedDoc(admin.id, { slug: "revoked-doc", title: "Revoked Doc" });

    await seedShare(docActive.id, client.id);
    await seedShare(docRevoked.id, client.id, { revokedAt: new Date("2026-01-01T00:00:00Z") });

    const rows = await queries.listDocsForClientWithLastViewed(client.id, member.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(docActive.id);
  });

  it("orders results by sharedAt DESC — most recently shared first", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("order-test");
    const member = await seedMember(client.id, "user@edict.test");

    const docFirst = await seedDoc(admin.id, { slug: "first-shared", title: "First Shared" });
    const docSecond = await seedDoc(admin.id, { slug: "second-shared", title: "Second Shared" });
    const docThird = await seedDoc(admin.id, { slug: "third-shared", title: "Third Shared" });

    // Share with staggered timestamps.
    await seedShare(docFirst.id, client.id, { sharedAt: new Date("2026-01-01T00:00:00Z") });
    await seedShare(docSecond.id, client.id, { sharedAt: new Date("2026-02-01T00:00:00Z") });
    await seedShare(docThird.id, client.id, { sharedAt: new Date("2026-03-01T00:00:00Z") });

    const rows = await queries.listDocsForClientWithLastViewed(client.id, member.id);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.title).toBe("Third Shared");
    expect(rows[1]!.title).toBe("Second Shared");
    expect(rows[2]!.title).toBe("First Shared");
  });
});
