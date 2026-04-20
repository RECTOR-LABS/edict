/**
 * Integration tests for addMemberAction + revokeMemberAction (actions/members.ts).
 *
 * Pattern matches create-client-action.test.ts (Task 37):
 * - Real DB via @testcontainers/postgresql
 * - runWithContext() for auth context — no vi.mock of lib/auth/context
 * - vi.mock("next/cache") to suppress revalidatePath module-load errors
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type { addMemberAction, revokeMemberAction } from "@/actions/members";
import type { runWithContext } from "@/lib/auth/context";

// ---------------------------------------------------------------------------
// Mock next/cache — revalidatePath has no meaningful behavior in integration
// tests and throws without a Next.js runtime.
// ---------------------------------------------------------------------------
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock requireAdminSession — bypasses cookies()/Next.js request scope.
// Tests set ALS context via runWithContext(); requireAdminSession just
// needs to invoke fn() so getContext() reads from that established store.
// ---------------------------------------------------------------------------
vi.mock("@/lib/auth/middleware", () => ({
  requireAdminSession: vi.fn(<T>(fn: () => Promise<T>) => fn()),
}));

// ---------------------------------------------------------------------------
// Container + DB bootstrap
// ---------------------------------------------------------------------------

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let addAction: typeof addMemberAction | undefined;
let revokeAction: typeof revokeMemberAction | undefined;
let ctxHelper: typeof runWithContext | undefined;

const MOCK_ADMIN_ID = "00000000-0000-0000-0000-000000000001";
// A fixed client UUID inserted as a seed row for all member tests.
const SEED_CLIENT_ID = "00000000-0000-0000-0000-000000000010";

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

  // Set env vars BEFORE dynamic imports.
  const host = pg.getHost();
  const port = pg.getMappedPort(5432);
  process.env.DATABASE_URL = `postgres://edict_app:dev@${host}:${port}/edict`;
  process.env.DATABASE_ADMIN_URL = pg.getConnectionUri();

  // Dynamic imports AFTER env is set.
  dbModule = await import("@/lib/db");

  // Seed admin.
  await dbModule.adminDb.insert(dbModule.schema.admins).values({
    id: MOCK_ADMIN_ID,
    email: "admin@edict.test",
  });

  // Seed client — every member test targets this client.
  await dbModule.adminDb.insert(dbModule.schema.clients).values({
    id: SEED_CLIENT_ID,
    slug: "test-co",
    name: "Test Co",
  });

  const membersModule = await import("@/actions/members");
  addAction = membersModule.addMemberAction;
  revokeAction = membersModule.revokeMemberAction;

  const contextModule = await import("@/lib/auth/context");
  ctxHelper = contextModule.runWithContext;
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

// Reset member + audit rows before each test for full isolation.
// Keep the seeded admin + client rows.
beforeEach(async () => {
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  await adminDb.delete(schema.auditLog);
  await adminDb.delete(schema.clientMembers);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function adminCtx() {
  return {
    kind: "admin" as const,
    sessionId: "session-test-admin",
    adminId: MOCK_ADMIN_ID,
  };
}

function clientCtx() {
  return {
    kind: "client" as const,
    sessionId: "session-test-client",
    memberId: "00000000-0000-0000-0000-000000000002",
    clientId: SEED_CLIENT_ID,
    clientSlug: "test-co",
  };
}

// ---------------------------------------------------------------------------
// addMemberAction tests
// ---------------------------------------------------------------------------

describe("addMemberAction", () => {
  // Test 1: Admin + valid input → new member inserted, audit event written.
  it("inserts new member (email lowercased) and writes admin_action audit event", async () => {
    const fd = makeFormData({
      clientId: SEED_CLIENT_ID,
      email: "  Alice@Example.COM  ",
      name: "Alice",
      role: "viewer",
    });

    await ctxHelper!(adminCtx(), () => addAction!(fd));

    const { adminDb, schema } = dbModule!;

    // Assert member inserted with normalised email.
    const members = await adminDb.select().from(schema.clientMembers);
    expect(members).toHaveLength(1);
    const member = members[0]!;
    expect(member.email).toBe("alice@example.com");
    expect(member.name).toBe("Alice");
    expect(member.role).toBe("viewer");
    expect(member.revokedAt).toBeNull();

    // Assert audit event.
    const audits = await adminDb.select().from(schema.auditLog);
    expect(audits).toHaveLength(1);
    const audit = audits[0]!;
    expect(audit.eventType).toBe("admin_action");
    expect(audit.actorType).toBe("admin");
    expect(audit.actorId).toBe(MOCK_ADMIN_ID);
    expect(audit.clientId).toBe(SEED_CLIENT_ID);
    const meta = audit.metadata as Record<string, unknown>;
    expect(meta.target_type).toBe("client_member");
    expect(meta.target_id).toBe(member.id);
    expect(meta.action).toBe("upsert");
  });

  // Test 2: Admin + existing active member → no duplicate, still writes audit.
  it("returns existing active member without duplicating, still writes audit event", async () => {
    const fd = makeFormData({
      clientId: SEED_CLIENT_ID,
      email: "bob@example.com",
      role: "viewer",
    });

    // First add.
    await ctxHelper!(adminCtx(), () => addAction!(fd));

    // Clear audit so we can count clean for second add.
    const { adminDb, schema } = dbModule!;
    await adminDb.delete(schema.auditLog);

    // Second add — same email.
    await ctxHelper!(adminCtx(), () => addAction!(fd));

    // Still only 1 member row.
    const members = await adminDb.select().from(schema.clientMembers);
    expect(members).toHaveLength(1);

    // One new audit event was still written.
    const audits = await adminDb.select().from(schema.auditLog);
    expect(audits).toHaveLength(1);
    expect((audits[0]!.metadata as Record<string, unknown>).action).toBe("upsert");
  });

  // Test 3: Admin + existing revoked member → reinstated (revokedAt cleared), audit written.
  it("reinstates revoked member and writes audit event", async () => {
    const { adminDb, schema } = dbModule!;

    // Insert a revoked member directly.
    await adminDb.insert(schema.clientMembers).values({
      clientId: SEED_CLIENT_ID,
      email: "carol@example.com",
      role: "viewer",
      revokedAt: new Date("2025-01-01T00:00:00Z"),
    });

    const fd = makeFormData({
      clientId: SEED_CLIENT_ID,
      email: "carol@example.com",
      role: "viewer",
    });

    await ctxHelper!(adminCtx(), () => addAction!(fd));

    // revokedAt should now be null.
    const members = await adminDb.select().from(schema.clientMembers);
    expect(members).toHaveLength(1);
    expect(members[0]!.revokedAt).toBeNull();

    // Audit event written.
    const audits = await adminDb.select().from(schema.auditLog);
    expect(audits).toHaveLength(1);
    expect((audits[0]!.metadata as Record<string, unknown>).action).toBe("upsert");
  });

  // Test 4: Non-admin context → throws "admin only", no DB change.
  it("throws 'admin only' when context kind is 'client'", async () => {
    const fd = makeFormData({
      clientId: SEED_CLIENT_ID,
      email: "dave@example.com",
      role: "viewer",
    });

    await ctxHelper!(clientCtx(), async () => {
      await expect(addAction!(fd)).rejects.toThrow("admin only");
    });

    const { adminDb, schema } = dbModule!;
    const members = await adminDb.select().from(schema.clientMembers);
    expect(members).toHaveLength(0);
    const audits = await adminDb.select().from(schema.auditLog);
    expect(audits).toHaveLength(0);
  });

  // Test 5: Role fallback — no role in FormData → defaults to "viewer".
  it("defaults role to 'viewer' when role is not provided in formData", async () => {
    // Intentionally omit "role" from the form data.
    const fd = makeFormData({
      clientId: SEED_CLIENT_ID,
      email: "eve@example.com",
    });

    await ctxHelper!(adminCtx(), () => addAction!(fd));

    const { adminDb, schema } = dbModule!;
    const members = await adminDb.select().from(schema.clientMembers);
    expect(members).toHaveLength(1);
    expect(members[0]!.role).toBe("viewer");
  });
});

// ---------------------------------------------------------------------------
// revokeMemberAction tests
// ---------------------------------------------------------------------------

describe("revokeMemberAction", () => {
  // Test 6: Admin + existing active member → revokedAt set, audit written.
  it("sets revokedAt on active member and writes admin_action audit event", async () => {
    const { adminDb, schema } = dbModule!;

    // Insert active member.
    const [inserted] = await adminDb
      .insert(schema.clientMembers)
      .values({ clientId: SEED_CLIENT_ID, email: "frank@example.com", role: "viewer" })
      .returning();
    const memberId = inserted!.id;

    const fd = makeFormData({ memberId, clientId: SEED_CLIENT_ID });

    await ctxHelper!(adminCtx(), () => revokeAction!(fd));

    // revokedAt is now set.
    const members = await adminDb.select().from(schema.clientMembers);
    expect(members).toHaveLength(1);
    expect(members[0]!.revokedAt).not.toBeNull();

    // Audit event written.
    const audits = await adminDb.select().from(schema.auditLog);
    expect(audits).toHaveLength(1);
    const audit = audits[0]!;
    expect(audit.eventType).toBe("admin_action");
    expect(audit.actorId).toBe(MOCK_ADMIN_ID);
    const meta = audit.metadata as Record<string, unknown>;
    expect(meta.action).toBe("revoke");
    expect(meta.target_id).toBe(memberId);
  });

  // Test 7: Admin + already-revoked member → no-op on DB, BUT audit row still written.
  // Observation for Phase F2 hygiene: revoking an already-revoked member still emits
  // an audit row. Consider audit-only-on-state-change in a follow-up.
  it("no-ops on already-revoked member (revokedAt unchanged) but still writes audit event", async () => {
    const { adminDb, schema } = dbModule!;

    const originalRevokedAt = new Date("2025-06-15T12:00:00Z");

    const [inserted] = await adminDb
      .insert(schema.clientMembers)
      .values({
        clientId: SEED_CLIENT_ID,
        email: "grace@example.com",
        role: "viewer",
        revokedAt: originalRevokedAt,
      })
      .returning();
    const memberId = inserted!.id;

    const fd = makeFormData({ memberId, clientId: SEED_CLIENT_ID });

    await ctxHelper!(adminCtx(), () => revokeAction!(fd));

    // revokedAt must be unchanged — same timestamp as seeded.
    const members = await adminDb.select().from(schema.clientMembers);
    expect(members).toHaveLength(1);
    expect(members[0]!.revokedAt!.toISOString()).toBe(originalRevokedAt.toISOString());

    // Audit event was still written despite no DB state change.
    const audits = await adminDb.select().from(schema.auditLog);
    expect(audits).toHaveLength(1);
    expect((audits[0]!.metadata as Record<string, unknown>).action).toBe("revoke");
  });

  // Test 8: Non-admin context → throws "admin only".
  it("throws 'admin only' when context kind is 'client'", async () => {
    const fd = makeFormData({
      memberId: "00000000-0000-0000-0000-000000000099",
      clientId: SEED_CLIENT_ID,
    });

    await ctxHelper!(clientCtx(), async () => {
      await expect(revokeAction!(fd)).rejects.toThrow("admin only");
    });

    const { adminDb, schema } = dbModule!;
    const audits = await adminDb.select().from(schema.auditLog);
    expect(audits).toHaveLength(0);
  });

  // Test 9: Non-existent memberId → revokeMember silently no-ops, action still writes audit.
  // Observation for Phase F2 hygiene: the action writes an audit row even when no member
  // was matched. Consider validating member existence before the audit write in a follow-up.
  it("silently no-ops DB update for non-existent memberId but still writes audit event", async () => {
    const nonExistentId = "00000000-0000-0000-0000-000000000099";
    const fd = makeFormData({ memberId: nonExistentId, clientId: SEED_CLIENT_ID });

    await ctxHelper!(adminCtx(), () => revokeAction!(fd));

    const { adminDb, schema } = dbModule!;

    // No members table rows (none inserted).
    const members = await adminDb.select().from(schema.clientMembers);
    expect(members).toHaveLength(0);

    // Audit row still written.
    const audits = await adminDb.select().from(schema.auditLog);
    expect(audits).toHaveLength(1);
    const meta = audits[0]!.metadata as Record<string, unknown>;
    expect(meta.action).toBe("revoke");
    expect(meta.target_id).toBe(nonExistentId);
  });
});
