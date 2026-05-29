import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type {
  upsertShare,
  revokeShare,
  listSharesForDoc,
} from "@/lib/db/queries/shares";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let queries: {
  upsertShare: typeof upsertShare;
  revokeShare: typeof revokeShare;
  listSharesForDoc: typeof listSharesForDoc;
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
  queries = await import("@/lib/db/queries/shares");
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

// Truncate in FK-safe order before each test.
// doc_shares → docs → admins + clients (independently; no FK between admins and clients).
beforeEach(async () => {
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  await adminDb.delete(schema.docShares);
  await adminDb.delete(schema.docs);
  await adminDb.delete(schema.admins);
  await adminDb.delete(schema.clients);
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

async function seedDoc(createdBy: string, slug?: string) {
  const { adminDb, schema } = dbModule!;
  const resolvedSlug = slug ?? `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [row] = await adminDb
    .insert(schema.docs)
    .values({
      slug: resolvedSlug,
      title: "Test Doc",
      bodyType: "html",
      body: "<p>hello</p>",
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

// ---------------------------------------------------------------------------
// upsertShare()
// ---------------------------------------------------------------------------

describe("upsertShare()", () => {
  it("inserts a new share and returns a row with generated id, revokedAt null, sharedAt populated", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("upsert-insert");
    const doc = await seedDoc(admin.id);

    const before = new Date();
    const row = await queries.upsertShare(doc.id, client.id);
    const after = new Date();

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.docId).toBe(doc.id);
    expect(row.clientId).toBe(client.id);
    expect(row.revokedAt).toBeNull();
    // sharedAt is set by the DB default now(); before/after are host-clock.
    // Allow a tolerance so DB/host clock skew (a remote DB, or a colima/Lima VM
    // whose clock drifts from the macOS host) doesn't fail a correctly-populated
    // timestamp while still catching null/epoch/far-future regressions.
    const SKEW_MS = 5_000;
    expect(row.sharedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - SKEW_MS);
    expect(row.sharedAt.getTime()).toBeLessThanOrEqual(after.getTime() + SKEW_MS);
  });

  it("returns the existing row unchanged when share is already active (no duplicate insert)", async () => {
    const { adminDb, schema } = dbModule!;
    const admin = await seedAdmin();
    const client = await seedClient("upsert-existing");
    const doc = await seedDoc(admin.id);

    const original = await seedShare(doc.id, client.id, {
      sharedAt: new Date("2025-06-01T00:00:00Z"),
    });

    const result = await queries.upsertShare(doc.id, client.id);

    // Returns the pre-existing row — same id.
    expect(result.id).toBe(original.id);

    // Still exactly one row in the table.
    const allRows = await adminDb
      .select()
      .from(schema.docShares)
      .then((rs) => rs.filter((r) => r.docId === doc.id && r.clientId === client.id));
    expect(allRows).toHaveLength(1);

    // sharedAt is unchanged — original timestamp preserved.
    expect(allRows[0]!.sharedAt.toISOString()).toBe(original.sharedAt.toISOString());
  });

  it("reinstates a revoked share — DB state: revokedAt null, sharedAt bumped to recent", async () => {
    const { adminDb } = dbModule!;
    const admin = await seedAdmin();
    const client = await seedClient("upsert-reinstate");
    const doc = await seedDoc(admin.id);

    const pastRevoked = new Date("2025-01-01T00:00:00Z");
    const revoked = await seedShare(doc.id, client.id, { revokedAt: pastRevoked });

    const before = new Date();
    const result = await queries.upsertShare(doc.id, client.id);
    const after = new Date();

    // Returns the existing row (stale revokedAt at return time — same pattern as upsertMember).
    expect(result.id).toBe(revoked.id);

    // Re-query to verify the reinstatement actually happened in DB.
    const requeried = await adminDb.query.docShares.findFirst({
      where: (s, { eq }) => eq(s.id, revoked.id),
    });
    expect(requeried).toBeDefined();
    expect(requeried!.revokedAt).toBeNull();
    expect(requeried!.sharedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(requeried!.sharedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("creates separate share rows for different clients sharing the same doc — no collision", async () => {
    const { adminDb, schema } = dbModule!;
    const admin = await seedAdmin();
    const clientA = await seedClient("multi-client-a");
    const clientB = await seedClient("multi-client-b");
    const doc = await seedDoc(admin.id);

    const shareA = await queries.upsertShare(doc.id, clientA.id);
    const shareB = await queries.upsertShare(doc.id, clientB.id);

    expect(shareA.id).not.toBe(shareB.id);
    expect(shareA.clientId).toBe(clientA.id);
    expect(shareB.clientId).toBe(clientB.id);

    const allRows = await adminDb
      .select()
      .from(schema.docShares)
      .then((rs) => rs.filter((r) => r.docId === doc.id));
    expect(allRows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// revokeShare()
// ---------------------------------------------------------------------------

describe("revokeShare()", () => {
  it("sets revokedAt to a recent timestamp on an active share", async () => {
    const { adminDb } = dbModule!;
    const admin = await seedAdmin();
    const client = await seedClient("revoke-happy");
    const doc = await seedDoc(admin.id);
    await seedShare(doc.id, client.id);

    const before = new Date();
    await queries.revokeShare(doc.id, client.id);
    const after = new Date();

    const requeried = await adminDb.query.docShares.findFirst({
      where: (s, { and, eq }) => and(eq(s.docId, doc.id), eq(s.clientId, client.id)),
    });
    expect(requeried).toBeDefined();
    expect(requeried!.revokedAt).not.toBeNull();
    expect(requeried!.revokedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(requeried!.revokedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("is idempotent — does NOT overwrite revokedAt on an already-revoked share (isNull guard)", async () => {
    const { adminDb } = dbModule!;
    const admin = await seedAdmin();
    const client = await seedClient("revoke-idempotent");
    const doc = await seedDoc(admin.id);

    const pastTimestamp = new Date("2025-03-15T12:00:00Z");
    await seedShare(doc.id, client.id, { revokedAt: pastTimestamp });

    // Call revokeShare — the WHERE has isNull(revokedAt) so it should no-op.
    await queries.revokeShare(doc.id, client.id);

    const requeried = await adminDb.query.docShares.findFirst({
      where: (s, { and, eq }) => and(eq(s.docId, doc.id), eq(s.clientId, client.id)),
    });
    expect(requeried).toBeDefined();
    // revokedAt must still be the original past timestamp, not refreshed to now().
    expect(requeried!.revokedAt!.toISOString()).toBe(pastTimestamp.toISOString());
  });

  it("does not affect a share for a different client — zero rows matched, original share unchanged", async () => {
    const { adminDb } = dbModule!;
    const admin = await seedAdmin();
    const clientA = await seedClient("revoke-scope-a");
    const clientB = await seedClient("revoke-scope-b");
    const doc = await seedDoc(admin.id);

    // Only clientA has a share for this doc.
    await seedShare(doc.id, clientA.id);

    // Attempt to revoke for clientB — no matching row.
    await queries.revokeShare(doc.id, clientB.id);

    // clientA's share must be untouched.
    const requeried = await adminDb.query.docShares.findFirst({
      where: (s, { and, eq }) => and(eq(s.docId, doc.id), eq(s.clientId, clientA.id)),
    });
    expect(requeried).toBeDefined();
    expect(requeried!.revokedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listSharesForDoc()
// ---------------------------------------------------------------------------

describe("listSharesForDoc()", () => {
  it("returns ALL shares for a doc — including revoked ones — ordered by sharedAt desc", async () => {
    const admin = await seedAdmin();
    const clientA = await seedClient("list-shares-a");
    const clientB = await seedClient("list-shares-b");
    const clientC = await seedClient("list-shares-c");
    const doc = await seedDoc(admin.id);

    // Seed 2 active + 1 revoked, with explicit sharedAt for ordering verification.
    const shareOldest = await seedShare(doc.id, clientA.id, {
      sharedAt: new Date("2025-01-01T00:00:00Z"),
    });
    const shareMiddle = await seedShare(doc.id, clientB.id, {
      sharedAt: new Date("2025-06-01T00:00:00Z"),
      revokedAt: new Date("2025-07-01T00:00:00Z"),
    });
    const shareNewest = await seedShare(doc.id, clientC.id, {
      sharedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const rows = await queries.listSharesForDoc(doc.id);

    // All 3 rows returned — revoked share INCLUDED (admin history view).
    expect(rows).toHaveLength(3);

    // Descending by sharedAt: newest first.
    expect(rows[0]!.id).toBe(shareNewest.id);
    expect(rows[1]!.id).toBe(shareMiddle.id);
    expect(rows[2]!.id).toBe(shareOldest.id);

    // Confirm the revoked share is present (not filtered out).
    const revokedRow = rows.find((r) => r.id === shareMiddle.id);
    expect(revokedRow).toBeDefined();
    expect(revokedRow!.revokedAt).not.toBeNull();
  });
});
