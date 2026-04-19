import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type { requestMagicLinkAction } from "@/actions/sessions";

// Mock next/cache before any imports — revalidatePath is a no-op in test env.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let requestMagicLink: typeof requestMagicLinkAction | undefined;

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
  // APP_URL is required by the dispatch helper for token URL construction.
  process.env.APP_URL = "http://localhost:3000";
  // Force dev-print path — no Resend call in tests.
  process.env.DEV_PRINT_MAGIC_LINKS = "true";
  delete process.env.RESEND_API_KEY;

  // Dynamic imports AFTER env is set.
  dbModule = await import("@/lib/db");
  const sessionsModule = await import("@/actions/sessions");
  requestMagicLink = sessionsModule.requestMagicLinkAction;
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

// Reset tables before each test for full isolation without extra containers.
beforeEach(async () => {
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  // Reset: audit_log, magic_link_tokens, sessions have no FK to clients/admins/client_members
  // that would block truncation. Truncate in dependency-safe order.
  await adminDb.delete(schema.auditLog);
  await adminDb.delete(schema.magicLinkTokens);
  await adminDb.delete(schema.sessions);
  await adminDb.delete(schema.clientMembers);
  await adminDb.delete(schema.clients);
  await adminDb.delete(schema.admins);
});

function makeFormData(email: string): FormData {
  const fd = new FormData();
  fd.append("email", email);
  return fd;
}

describe("requestMagicLinkAction", () => {
  // ── Test 1: Admin email match ──────────────────────────────────────────────
  it("admin email match → issues magic_link_tokens row with subject_type=admin, client_id=null", async () => {
    expect(requestMagicLink).toBeDefined();
    const { adminDb, schema } = dbModule!;

    // Seed an admin row.
    await adminDb.insert(schema.admins).values({ email: "ada@edict.test" });
    const admins = await adminDb.query.admins.findMany({});
    const admin = admins[0]!;

    await requestMagicLink!(makeFormData("ada@edict.test"));

    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(1);
    const tok = tokens[0]!;
    expect(tok.subjectType).toBe("admin");
    expect(tok.subjectId).toBe(admin.id);
    expect(tok.clientId).toBeNull();
    expect(tok.email).toBe("ada@edict.test");
    expect(tok.consumedAt).toBeNull();
    expect(tok.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  // ── Test 2: Client member match (single tenant) ────────────────────────────
  it("client member match (single tenant) → one token row + magic_link_requested audit", async () => {
    expect(requestMagicLink).toBeDefined();
    const { adminDb, schema } = dbModule!;

    // Seed client + member.
    await adminDb.insert(schema.clients).values({
      slug: "acme",
      name: "Acme Corp",
    });
    const clients = await adminDb.query.clients.findMany({});
    const client = clients[0]!;

    await adminDb.insert(schema.clientMembers).values({
      clientId: client.id,
      email: "bob@acme.test",
      role: "viewer",
    });
    const members = await adminDb.query.clientMembers.findMany({});
    const member = members[0]!;

    await requestMagicLink!(makeFormData("bob@acme.test"));

    // One token row.
    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(1);
    const tok = tokens[0]!;
    expect(tok.subjectType).toBe("client_member");
    expect(tok.subjectId).toBe(member.id);
    expect(tok.clientId).toBe(client.id);
    expect(tok.email).toBe("bob@acme.test");
    expect(tok.consumedAt).toBeNull();

    // One magic_link_requested audit event.
    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.eventType, "magic_link_requested"),
    });
    expect(audits).toHaveLength(1);
    const audit = audits[0]!;
    expect(audit.actorType).toBe("system");
    expect(audit.metadata).toMatchObject({
      email_hash_prefix: "bo***",
    });
  });

  // ── Test 3: Client member match (multi-tenant) ─────────────────────────────
  it("client member match (multi-tenant) → two token rows, correct client_ids each", async () => {
    expect(requestMagicLink).toBeDefined();
    const { adminDb, schema } = dbModule!;

    // Seed two clients.
    await adminDb.insert(schema.clients).values([
      { slug: "alpha-corp", name: "Alpha Corp" },
      { slug: "beta-inc", name: "Beta Inc" },
    ]);
    const clients = await adminDb.query.clients.findMany({});
    const [clientA, clientB] = clients as [typeof clients[0], typeof clients[0]];

    // Same email in both tenants.
    const sharedEmail = "carol@shared.test";
    await adminDb.insert(schema.clientMembers).values([
      { clientId: clientA!.id, email: sharedEmail, role: "viewer" },
      { clientId: clientB!.id, email: sharedEmail, role: "viewer" },
    ]);
    const members = await adminDb.query.clientMembers.findMany({});

    await requestMagicLink!(makeFormData(sharedEmail));

    // Two token rows — one per member.
    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(2);

    const tokenClientIds = new Set(tokens.map((t) => t.clientId));
    expect(tokenClientIds).toContain(clientA!.id);
    expect(tokenClientIds).toContain(clientB!.id);

    // Each token references the correct member.
    for (const tok of tokens) {
      const matchingMember = members.find((m) => m.clientId === tok.clientId);
      expect(matchingMember).toBeDefined();
      expect(tok.subjectId).toBe(matchingMember!.id);
      expect(tok.subjectType).toBe("client_member");
    }

    // One magic_link_requested audit event (written once after the loop).
    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.eventType, "magic_link_requested"),
    });
    expect(audits).toHaveLength(1);
  });

  // ── Test 4: Unknown email ──────────────────────────────────────────────────
  it("unknown email → zero tokens, one magic_link_requested audit with hashed prefix", async () => {
    expect(requestMagicLink).toBeDefined();
    const { adminDb, schema } = dbModule!;

    await requestMagicLink!(makeFormData("ghost@nowhere.test"));

    // Zero token rows.
    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(0);

    // One audit event still written (enumeration defense — identical behavior).
    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.eventType, "magic_link_requested"),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({
      email_hash_prefix: "gh***",
    });
  });

  // ── Test 5: Empty email ────────────────────────────────────────────────────
  it("empty email → early return, zero inserts, zero audit events", async () => {
    expect(requestMagicLink).toBeDefined();
    const { adminDb, schema } = dbModule!;

    await requestMagicLink!(makeFormData(""));

    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(0);

    const audits = await adminDb.query.auditLog.findMany({});
    expect(audits).toHaveLength(0);
  });

  // ── Test 6: Whitespace-only email ─────────────────────────────────────────
  it("whitespace-only email → trim → falsy → early return, zero inserts, zero audits", async () => {
    expect(requestMagicLink).toBeDefined();
    const { adminDb, schema } = dbModule!;

    // "   ".trim() === "" → falsy → same early-return path as empty string.
    await requestMagicLink!(makeFormData("   "));

    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(0);

    const audits = await adminDb.query.auditLog.findMany({});
    expect(audits).toHaveLength(0);
  });

  // ── Test 7: Revoked client_member exclusion ────────────────────────────────
  it("revoked client_member → not matched, zero tokens, still emits audit", async () => {
    expect(requestMagicLink).toBeDefined();
    const { adminDb, schema } = dbModule!;

    // Seed client + revoked member.
    await adminDb.insert(schema.clients).values({ slug: "legacy-co", name: "Legacy Co" });
    const clients = await adminDb.query.clients.findMany({});
    const client = clients[0]!;

    await adminDb.insert(schema.clientMembers).values({
      clientId: client.id,
      email: "revoked@legacy.test",
      role: "viewer",
      revokedAt: new Date(), // explicitly revoked
    });

    await requestMagicLink!(makeFormData("revoked@legacy.test"));

    // No token issued for the revoked member.
    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(0);

    // Generic audit event still emitted (silent success — no leak about revocation status).
    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.eventType, "magic_link_requested"),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({
      email_hash_prefix: "re***",
    });
  });
});
