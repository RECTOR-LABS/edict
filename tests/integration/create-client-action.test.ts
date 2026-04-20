/**
 * Integration tests for createClientAction (actions/clients.ts).
 *
 * Coverage decision: option (b)(ii) — integration tests for the server action
 * (real DB, real getContext via runWithContext, mocked next/navigation redirect).
 * Server component rendering deferred to Phase H E2E per Task 36/37 precedent.
 *
 * getContext() approach: use runWithContext() from lib/auth/context — the action
 * calls getContext() which reads AsyncLocalStorage; wrapping the call in
 * runWithContext() is the same mechanism the real middleware uses, so no mocking
 * of the module is required. This is cleaner than vi.mock and exercises the real
 * code path.
 *
 * redirect() approach: mock next/navigation so redirect() throws
 * `Error("REDIRECT:<url>")` — mirrors the real NEXT_REDIRECT throw without
 * requiring a full Next.js runtime.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type { createClientAction } from "@/actions/clients";
import type { runWithContext } from "@/lib/auth/context";

// ---------------------------------------------------------------------------
// Mock next/navigation — redirect() must throw for Next.js server actions.
// Must be declared before any module that imports it.
// ---------------------------------------------------------------------------
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

// ---------------------------------------------------------------------------
// Container + DB bootstrap
// ---------------------------------------------------------------------------

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let action: typeof createClientAction | undefined;
let ctxHelper: typeof runWithContext | undefined;

const MOCK_ADMIN_ID = "00000000-0000-0000-0000-000000000001";

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

  // Seed the mock admin so the admin FK lookup in the page doesn't fail
  // (action itself doesn't query admins table, but other tests may coexist).
  // Insert directly — no adminId FK constraint on audit_log for admin_action events.
  await dbModule.adminDb.insert(dbModule.schema.admins).values({
    id: MOCK_ADMIN_ID,
    email: "admin@edict.test",
  });

  const clientsModule = await import("@/actions/clients");
  action = clientsModule.createClientAction;

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

// Reset data tables before each test for full isolation.
beforeEach(async () => {
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  // Clear in FK-safe order (audit_log has no child tables; clients cascades to members).
  await adminDb.delete(schema.auditLog);
  await adminDb.delete(schema.clientMembers);
  await adminDb.delete(schema.clients);
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
    sessionId: "session-test-1",
    adminId: MOCK_ADMIN_ID,
  };
}

function clientCtx() {
  return {
    kind: "client" as const,
    sessionId: "session-test-2",
    memberId: "00000000-0000-0000-0000-000000000002",
    clientId: "00000000-0000-0000-0000-000000000003",
    clientSlug: "test-client",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createClientAction", () => {
  // Test 1: Happy path — admin context + full valid input
  it("inserts client row, writes admin_action audit event, and redirects to /admin/clients/:id", async () => {
    const fd = makeFormData({
      slug: "adrena",
      name: "Adrena Trading",
      brandColor: "#00e5ff",
      logoUrl: "https://cdn.adrena.xyz/logo.png",
    });

    let caughtErr: Error | undefined;
    await ctxHelper!(adminCtx(), async () => {
      try {
        await action!(fd);
        expect.fail("expected NEXT_REDIRECT throw");
      } catch (err) {
        caughtErr = err as Error;
      }
    });

    // Assert redirect threw with correct URL shape.
    expect(caughtErr).toBeDefined();
    expect(caughtErr!.message).toMatch(/^REDIRECT:\/admin\/clients\/[0-9a-f-]{36}$/);

    // Extract inserted client id from redirect URL.
    const clientId = caughtErr!.message.replace("REDIRECT:/admin/clients/", "");

    // Assert client row was inserted with correct fields.
    const { adminDb, schema } = dbModule!;
    const clients = await adminDb.select().from(schema.clients);
    expect(clients).toHaveLength(1);
    expect(clients[0]!.id).toBe(clientId);
    expect(clients[0]!.slug).toBe("adrena");
    expect(clients[0]!.name).toBe("Adrena Trading");
    expect(clients[0]!.brandColor).toBe("#00e5ff");
    expect(clients[0]!.logoUrl).toBe("https://cdn.adrena.xyz/logo.png");

    // Assert audit event was written.
    const auditRows = await adminDb.select().from(schema.auditLog);
    expect(auditRows).toHaveLength(1);
    const audit = auditRows[0]!;
    expect(audit.eventType).toBe("admin_action");
    expect(audit.actorType).toBe("admin");
    expect(audit.actorId).toBe(MOCK_ADMIN_ID);
    expect(audit.clientId).toBe(clientId);
    expect((audit.metadata as Record<string, unknown>).action).toBe("create");
    expect((audit.metadata as Record<string, unknown>).target_type).toBe("client");
    expect((audit.metadata as Record<string, unknown>).target_id).toBe(clientId);
  });

  // Test 2: Non-admin context → throws "admin only", no client inserted
  it("throws 'admin only' when context kind is 'client'", async () => {
    const fd = makeFormData({ slug: "should-not-insert", name: "Should Not Insert" });

    await ctxHelper!(clientCtx(), async () => {
      await expect(action!(fd)).rejects.toThrow("admin only");
    });

    const { adminDb, schema } = dbModule!;
    const clients = await adminDb.select().from(schema.clients);
    expect(clients).toHaveLength(0);
  });

  // Test 3: Invalid slug (spaces and uppercase) → throws "invalid slug", no insert
  it("throws 'invalid slug' when slug contains invalid characters", async () => {
    const fd = makeFormData({ slug: "Adrena Trading", name: "Adrena" });

    await ctxHelper!(adminCtx(), async () => {
      await expect(action!(fd)).rejects.toThrow("invalid slug");
    });

    const { adminDb, schema } = dbModule!;
    const clients = await adminDb.select().from(schema.clients);
    expect(clients).toHaveLength(0);
  });

  // Test 4: Empty name (valid slug) → throws "name required", no insert
  it("throws 'name required' when name is empty", async () => {
    const fd = makeFormData({ slug: "valid-slug", name: "" });

    await ctxHelper!(adminCtx(), async () => {
      await expect(action!(fd)).rejects.toThrow("name required");
    });

    const { adminDb, schema } = dbModule!;
    const clients = await adminDb.select().from(schema.clients);
    expect(clients).toHaveLength(0);
  });

  // Test 5: No brand color / logo URL → client created with null optional fields
  it("creates client with null brandColor and logoUrl when optional fields are omitted", async () => {
    const fd = makeFormData({ slug: "bare-client", name: "Bare Client" });
    // brandColor and logoUrl not set — FormData.get() returns null for missing keys,
    // action coerces to empty string then to undefined, createClient maps undefined → null.

    await ctxHelper!(adminCtx(), async () => {
      try {
        await action!(fd);
        expect.fail("expected NEXT_REDIRECT throw");
      } catch (err) {
        expect((err as Error).message).toMatch(/^REDIRECT:/);
      }
    });

    const { adminDb, schema } = dbModule!;
    const clients = await adminDb.select().from(schema.clients);
    expect(clients).toHaveLength(1);
    expect(clients[0]!.brandColor).toBeNull();
    expect(clients[0]!.logoUrl).toBeNull();
  });

  // Test 6: Duplicate slug → Postgres unique-constraint error propagates
  it("propagates unique-constraint error on duplicate slug", async () => {
    const fd1 = makeFormData({ slug: "duplicate", name: "First" });
    const fd2 = makeFormData({ slug: "duplicate", name: "Second" });

    // Insert first — should succeed.
    await ctxHelper!(adminCtx(), async () => {
      try {
        await action!(fd1);
      } catch (err) {
        // NEXT_REDIRECT from first insert — expected.
        expect((err as Error).message).toMatch(/^REDIRECT:/);
      }
    });

    // Insert second — should throw Postgres constraint error.
    await ctxHelper!(adminCtx(), async () => {
      await expect(action!(fd2)).rejects.toThrow();
    });

    // Only one client row should exist.
    const { adminDb, schema } = dbModule!;
    const clients = await adminDb.select().from(schema.clients);
    expect(clients).toHaveLength(1);
    expect(clients[0]!.name).toBe("First");
  });
});
