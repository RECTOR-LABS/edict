/**
 * Integration tests for createDocAction + updateDocAction (actions/docs.ts).
 *
 * Pattern matches create-client-action.test.ts (Task 37):
 * - Real DB via @testcontainers/postgresql
 * - runWithContext() for auth context — no vi.mock of lib/auth/context
 * - vi.mock("next/navigation") to turn redirect() into a trackable throw
 *   (no revalidatePath in these actions — both terminate with redirect())
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type { createDocAction, updateDocAction } from "@/actions/docs";
import type { runWithContext } from "@/lib/auth/context";

// ---------------------------------------------------------------------------
// Mock next/navigation — redirect() throws NEXT_REDIRECT in a real Next.js
// runtime; replicate that pattern here so the action's redirect() is
// testable without a full runtime.
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
let createAction: typeof createDocAction | undefined;
let updateAction: typeof updateDocAction | undefined;
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

  // Seed admin — required because docs.createdBy references admins.id (FK).
  await dbModule.adminDb.insert(dbModule.schema.admins).values({
    id: MOCK_ADMIN_ID,
    email: "admin@edict.test",
  });

  const docsModule = await import("@/actions/docs");
  createAction = docsModule.createDocAction;
  updateAction = docsModule.updateDocAction;

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

// Reset docs + audit rows before each test for full isolation.
// Keep the seeded admin row (FK anchor).
beforeEach(async () => {
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  // Clear in FK-safe order: audit_log has no children; doc_shares → docs
  await adminDb.delete(schema.auditLog);
  await adminDb.delete(schema.docShares);
  await adminDb.delete(schema.docs);
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
    clientId: "00000000-0000-0000-0000-000000000003",
    clientSlug: "test-co",
  };
}

// ---------------------------------------------------------------------------
// createDocAction tests
// ---------------------------------------------------------------------------

describe("createDocAction", () => {
  // Test 1: Admin + valid input → doc inserted, audit event written, redirect to /admin/docs/:id
  it("inserts doc with all fields, writes admin_action audit event, and redirects to /admin/docs/:id", async () => {
    const fd = makeFormData({
      slug: "adrena-implementation-plan",
      title: "Adrena Trading Arena — Implementation Plan",
      bodyType: "html",
      body: "<!DOCTYPE html><html><body>content</body></html>",
    });

    let caughtErr: Error | undefined;
    await ctxHelper!(adminCtx(), async () => {
      try {
        await createAction!(fd);
        expect.fail("expected NEXT_REDIRECT throw");
      } catch (err) {
        caughtErr = err as Error;
      }
    });

    // Assert redirect threw with correct URL shape.
    expect(caughtErr).toBeDefined();
    expect(caughtErr!.message).toMatch(/^REDIRECT:\/admin\/docs\/[0-9a-f-]{36}$/);

    // Extract inserted doc id from redirect URL.
    const docId = caughtErr!.message.replace("REDIRECT:/admin/docs/", "");

    const { adminDb, schema } = dbModule!;

    // Assert doc row was inserted with correct fields.
    const docRows = await adminDb.select().from(schema.docs);
    expect(docRows).toHaveLength(1);
    const doc = docRows[0]!;
    expect(doc.id).toBe(docId);
    expect(doc.slug).toBe("adrena-implementation-plan");
    expect(doc.title).toBe("Adrena Trading Arena — Implementation Plan");
    expect(doc.bodyType).toBe("html");
    expect(doc.body).toBe("<!DOCTYPE html><html><body>content</body></html>");
    expect(doc.createdBy).toBe(MOCK_ADMIN_ID);

    // Assert audit event was written with correct shape.
    const auditRows = await adminDb.select().from(schema.auditLog);
    expect(auditRows).toHaveLength(1);
    const audit = auditRows[0]!;
    expect(audit.eventType).toBe("admin_action");
    expect(audit.actorType).toBe("admin");
    expect(audit.actorId).toBe(MOCK_ADMIN_ID);
    expect(audit.docId).toBe(docId);
    const meta = audit.metadata as Record<string, unknown>;
    expect(meta.target_type).toBe("doc");
    expect(meta.target_id).toBe(docId);
    expect(meta.action).toBe("create");
    expect(meta.title).toBe("Adrena Trading Arena — Implementation Plan");
  });

  // Test 2: Non-admin context → throws "admin only", no doc inserted.
  it("throws 'admin only' when context kind is 'client'", async () => {
    const fd = makeFormData({
      slug: "should-not-insert",
      title: "Should Not Insert",
      bodyType: "html",
      body: "content",
    });

    await ctxHelper!(clientCtx(), async () => {
      await expect(createAction!(fd)).rejects.toThrow("admin only");
    });

    const { adminDb, schema } = dbModule!;
    const docRows = await adminDb.select().from(schema.docs);
    expect(docRows).toHaveLength(0);
  });

  // Test 3: Invalid slug (uppercase + spaces) → throws "invalid slug", no doc inserted.
  it("throws 'invalid slug' when slug contains invalid characters", async () => {
    const fd = makeFormData({
      slug: "Has Spaces",
      title: "Some Title",
      bodyType: "html",
      body: "content",
    });

    await ctxHelper!(adminCtx(), async () => {
      await expect(createAction!(fd)).rejects.toThrow("invalid slug");
    });

    const { adminDb, schema } = dbModule!;
    const docRows = await adminDb.select().from(schema.docs);
    expect(docRows).toHaveLength(0);
  });

  // Test 4: Empty title → throws "title required", no doc inserted.
  it("throws 'title required' when title is empty", async () => {
    const fd = makeFormData({
      slug: "valid-slug",
      title: "",
      bodyType: "html",
      body: "content",
    });

    await ctxHelper!(adminCtx(), async () => {
      await expect(createAction!(fd)).rejects.toThrow("title required");
    });

    const { adminDb, schema } = dbModule!;
    const docRows = await adminDb.select().from(schema.docs);
    expect(docRows).toHaveLength(0);
  });

  // Test 5: Empty body → throws "body required", no doc inserted.
  it("throws 'body required' when body is empty", async () => {
    const fd = makeFormData({
      slug: "valid-slug",
      title: "Valid Title",
      bodyType: "html",
      body: "",
    });

    await ctxHelper!(adminCtx(), async () => {
      await expect(createAction!(fd)).rejects.toThrow("body required");
    });

    const { adminDb, schema } = dbModule!;
    const docRows = await adminDb.select().from(schema.docs);
    expect(docRows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateDocAction tests
// ---------------------------------------------------------------------------

describe("updateDocAction", () => {
  // Test 6: Admin + existing doc → doc updated, audit event written, redirect to /admin/docs/:id
  it("updates doc fields, bumps updatedAt, writes admin_action audit event, and redirects to /admin/docs/:id", async () => {
    const { adminDb, schema } = dbModule!;

    // Insert a doc directly to update.
    const [inserted] = await adminDb
      .insert(schema.docs)
      .values({
        slug: "original-slug",
        title: "Original Title",
        bodyType: "html",
        body: "original body",
        createdBy: MOCK_ADMIN_ID,
      })
      .returning();
    const docId = inserted!.id;
    const originalUpdatedAt = inserted!.updatedAt;

    // Small delay to ensure updatedAt changes — use a minimal 2ms sleep.
    await new Promise((r) => setTimeout(r, 2));

    const fd = makeFormData({
      id: docId,
      title: "Updated Title",
      body: "updated body",
      bodyType: "markdown",
    });

    let caughtErr: Error | undefined;
    await ctxHelper!(adminCtx(), async () => {
      try {
        await updateAction!(fd);
        expect.fail("expected NEXT_REDIRECT throw");
      } catch (err) {
        caughtErr = err as Error;
      }
    });

    // Assert redirect threw with the doc's id.
    expect(caughtErr).toBeDefined();
    expect(caughtErr!.message).toBe(`REDIRECT:/admin/docs/${docId}`);

    // Assert doc was updated.
    const docRows = await adminDb.select().from(schema.docs);
    expect(docRows).toHaveLength(1);
    const doc = docRows[0]!;
    expect(doc.title).toBe("Updated Title");
    expect(doc.body).toBe("updated body");
    expect(doc.bodyType).toBe("markdown");
    expect(doc.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());

    // Assert audit event was written.
    const auditRows = await adminDb.select().from(schema.auditLog);
    expect(auditRows).toHaveLength(1);
    const audit = auditRows[0]!;
    expect(audit.eventType).toBe("admin_action");
    expect(audit.actorType).toBe("admin");
    expect(audit.actorId).toBe(MOCK_ADMIN_ID);
    expect(audit.docId).toBe(docId);
    const meta = audit.metadata as Record<string, unknown>;
    expect(meta.target_type).toBe("doc");
    expect(meta.target_id).toBe(docId);
    expect(meta.action).toBe("update");
  });

  // Test 7: Non-existent doc id → updateDoc returns null, action throws "doc not found".
  it("throws 'doc not found' when doc id does not exist", async () => {
    const fd = makeFormData({
      id: "00000000-0000-0000-0000-000000000099",
      title: "Doesn't Matter",
      body: "content",
      bodyType: "html",
    });

    await ctxHelper!(adminCtx(), async () => {
      await expect(updateAction!(fd)).rejects.toThrow("doc not found");
    });

    // No audit row written (throw happens before writeAudit).
    const { adminDb, schema } = dbModule!;
    const auditRows = await adminDb.select().from(schema.auditLog);
    expect(auditRows).toHaveLength(0);
  });

  // Test 8: Non-admin context → throws "admin only".
  it("throws 'admin only' when context kind is 'client'", async () => {
    const fd = makeFormData({
      id: "00000000-0000-0000-0000-000000000099",
      title: "Doesn't Matter",
      body: "content",
      bodyType: "html",
    });

    await ctxHelper!(clientCtx(), async () => {
      await expect(updateAction!(fd)).rejects.toThrow("admin only");
    });

    const { adminDb, schema } = dbModule!;
    const auditRows = await adminDb.select().from(schema.auditLog);
    expect(auditRows).toHaveLength(0);
  });
});
