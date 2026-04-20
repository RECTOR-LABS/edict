import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type {
  listMembersForClient,
  upsertMember,
  revokeMember,
} from "@/lib/db/queries/members";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let queries: {
  listMembersForClient: typeof listMembersForClient;
  upsertMember: typeof upsertMember;
  revokeMember: typeof revokeMember;
};

beforeAll(async () => {
  pg = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("edict")
    .withUsername("edict_admin")
    .withPassword("test")
    .start();

  // Apply all migrations via the superuser connection (BYPASSRLS, create-role rights).
  const bootstrap = new Pool({ connectionString: pg.getConnectionUri() });
  const names = (await readdir("./migrations")).filter((n) => n.endsWith(".sql")).sort();
  for (const n of names) await bootstrap.query(await readFile(join("./migrations", n), "utf8"));
  await bootstrap.end();

  // Set env vars BEFORE dynamic imports — lib/db reads them at module evaluation time.
  const host = pg.getHost();
  const port = pg.getMappedPort(5432);
  process.env.DATABASE_URL = `postgres://edict_app:dev@${host}:${port}/edict`;
  process.env.DATABASE_ADMIN_URL = pg.getConnectionUri();

  // Dynamic imports AFTER env is set.
  dbModule = await import("@/lib/db");
  queries = await import("@/lib/db/queries/members");
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

// Truncate clients before each test — cascade clears client_members too.
beforeEach(async () => {
  if (!dbModule) return;
  await dbModule.adminDb.delete(dbModule.schema.clients);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedClient(slug: string) {
  const { adminDb, schema } = dbModule!;
  const [row] = await adminDb
    .insert(schema.clients)
    .values({ slug, name: slug })
    .returning();
  if (!row) throw new Error("seed client failed");
  return row;
}

async function seedMember(
  clientId: string,
  email: string,
  overrides: {
    name?: string | null;
    role?: "viewer" | "admin_of_client";
    createdAt?: Date;
    revokedAt?: Date | null;
  } = {},
) {
  const { adminDb, schema } = dbModule!;
  const [row] = await adminDb
    .insert(schema.clientMembers)
    .values({
      clientId,
      email,
      name: overrides.name ?? null,
      role: overrides.role ?? "viewer",
      createdAt: overrides.createdAt ?? new Date(),
      revokedAt: overrides.revokedAt ?? null,
    })
    .returning();
  if (!row) throw new Error("seed member failed");
  return row;
}

// ---------------------------------------------------------------------------
// listMembersForClient()
// ---------------------------------------------------------------------------

describe("listMembersForClient()", () => {
  it("returns [] on empty table", async () => {
    const client = await seedClient("empty-client");
    const rows = await queries.listMembersForClient(client.id);
    expect(rows).toEqual([]);
  });

  it("excludes revoked members — returns only active rows", async () => {
    const client = await seedClient("revoke-filter");
    const a = await seedMember(client.id, "a@test.com");
    const b = await seedMember(client.id, "b@test.com");
    const revoked = await seedMember(client.id, "revoked@test.com", {
      revokedAt: new Date("2025-01-01T00:00:00Z"),
    });

    const rows = await queries.listMembersForClient(client.id);
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(revoked.id);
  });

  it("orders results descending by createdAt (most-recent first)", async () => {
    const client = await seedClient("order-test");
    await seedMember(client.id, "oldest@test.com", {
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    await seedMember(client.id, "middle@test.com", {
      createdAt: new Date("2025-06-01T00:00:00Z"),
    });
    await seedMember(client.id, "newest@test.com", {
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const rows = await queries.listMembersForClient(client.id);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.email).toBe("newest@test.com");
    expect(rows[1]!.email).toBe("middle@test.com");
    expect(rows[2]!.email).toBe("oldest@test.com");
  });

  it("tenant isolation — only returns members for the queried client", async () => {
    const clientA = await seedClient("client-a");
    const clientB = await seedClient("client-b");

    const memberA1 = await seedMember(clientA.id, "a1@test.com");
    const memberA2 = await seedMember(clientA.id, "a2@test.com");
    await seedMember(clientB.id, "b1@test.com");

    const rows = await queries.listMembersForClient(clientA.id);
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(memberA1.id);
    expect(ids).toContain(memberA2.id);
  });
});

// ---------------------------------------------------------------------------
// upsertMember()
// ---------------------------------------------------------------------------

describe("upsertMember()", () => {
  it("inserts a new member and returns a row with all fields populated", async () => {
    const client = await seedClient("upsert-insert");

    const row = await queries.upsertMember({
      clientId: client.id,
      email: "new@test.com",
      name: "New User",
      role: "viewer",
    });

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.clientId).toBe(client.id);
    expect(row.email).toBe("new@test.com");
    expect(row.name).toBe("New User");
    expect(row.role).toBe("viewer");
    expect(row.revokedAt).toBeNull();
  });

  it("stores null for omitted name field — not undefined, not empty string", async () => {
    const client = await seedClient("upsert-null-name");

    const row = await queries.upsertMember({
      clientId: client.id,
      email: "noname@test.com",
      role: "admin_of_client",
    });

    expect(row.name).toBeNull();
  });

  it("returns existing active row unchanged (no duplicate insert) when same clientId + email", async () => {
    const { adminDb, schema } = dbModule!;
    const client = await seedClient("upsert-existing");
    const original = await seedMember(client.id, "existing@test.com", { name: "Original" });

    const result = await queries.upsertMember({
      clientId: client.id,
      email: "existing@test.com",
      name: "Should Not Change",
      role: "viewer",
    });

    // Returns the existing row — same id.
    expect(result.id).toBe(original.id);

    // Still only one row in the table for this clientId + email.
    const allRows = await adminDb
      .select()
      .from(schema.clientMembers)
      .then((rs) => rs.filter((r) => r.clientId === client.id && r.email === "existing@test.com"));
    expect(allRows).toHaveLength(1);
  });

  it("reinstates a revoked member — sets revokedAt back to null", async () => {
    const { adminDb } = dbModule!;
    const client = await seedClient("upsert-reinstate");
    const revoked = await seedMember(client.id, "revoked@test.com", {
      revokedAt: new Date("2025-01-01T00:00:00Z"),
    });

    const result = await queries.upsertMember({
      clientId: client.id,
      email: "revoked@test.com",
      role: "viewer",
    });

    // Returns the existing row.
    expect(result.id).toBe(revoked.id);

    // Confirm revokedAt is now null in the DB.
    const requeried = await adminDb.query.clientMembers.findFirst({
      where: (m, { eq }) => eq(m.id, revoked.id),
    });
    expect(requeried).toBeDefined();
    expect(requeried!.revokedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// revokeMember()
// ---------------------------------------------------------------------------

describe("revokeMember()", () => {
  it("sets revokedAt to a recent timestamp on an active member", async () => {
    const { adminDb } = dbModule!;
    const client = await seedClient("revoke-happy");
    const member = await seedMember(client.id, "active@test.com");
    expect(member.revokedAt).toBeNull();

    const before = new Date();
    await queries.revokeMember(member.id);
    const after = new Date();

    const requeried = await adminDb.query.clientMembers.findFirst({
      where: (m, { eq }) => eq(m.id, member.id),
    });
    expect(requeried).toBeDefined();
    expect(requeried!.revokedAt).not.toBeNull();
    expect(requeried!.revokedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(requeried!.revokedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("is idempotent — does NOT overwrite revokedAt on an already-revoked member", async () => {
    const { adminDb } = dbModule!;
    const client = await seedClient("revoke-idempotent");
    const pastTimestamp = new Date("2025-03-15T12:00:00Z");
    const member = await seedMember(client.id, "already-revoked@test.com", {
      revokedAt: pastTimestamp,
    });

    // Call revokeMember — the WHERE has isNull(revokedAt) so it should no-op.
    await queries.revokeMember(member.id);

    const requeried = await adminDb.query.clientMembers.findFirst({
      where: (m, { eq }) => eq(m.id, member.id),
    });
    expect(requeried).toBeDefined();
    // revokedAt must still be the original past timestamp, not refreshed to now().
    expect(requeried!.revokedAt!.toISOString()).toBe(pastTimestamp.toISOString());
  });
});
