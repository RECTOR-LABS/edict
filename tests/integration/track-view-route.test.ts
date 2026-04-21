import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import type * as DbModule from "@/lib/db";

// ---------------------------------------------------------------------------
// Mock next/headers — must be declared before any module that imports it.
// The route calls: const jar = await cookies(); jar.get(name)?.value
// We expose a mutable Map so each test can inject its own cookie state.
// ---------------------------------------------------------------------------
const cookieJar: Map<string, string> = new Map();

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieJar.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
}));

// ---------------------------------------------------------------------------
// Container + DB bootstrap
// ---------------------------------------------------------------------------
let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;

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
  process.env.APP_URL = "http://localhost:3000";

  // Dynamic import AFTER env vars are set.
  dbModule = await import("@/lib/db");
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

beforeEach(async () => {
  // Clear cookie jar so tests start with no session cookie by default.
  cookieJar.clear();

  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  await adminDb.delete(schema.auditLog);
  await adminDb.delete(schema.sessions);
  await adminDb.delete(schema.magicLinkTokens);
  await adminDb.delete(schema.clientMembers);
  await adminDb.delete(schema.docShares);
  await adminDb.delete(schema.docs);
  await adminDb.delete(schema.clients);
  await adminDb.delete(schema.admins);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost:3000/api/track/view", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * Seed a client + member + active session. Returns { client, member, session, raw }.
 */
async function seedClientMemberSession(opts?: { slug?: string; email?: string }) {
  const { adminDb, schema } = dbModule!;
  const { sha256Hex } = await import("@/lib/utils/hash");
  const { issueMagicLink } = await import("@/lib/auth/issue");
  const { verifyMagicLink } = await import("@/lib/auth/verify");

  const slug = opts?.slug ?? "track-corp";
  const email = opts?.email ?? "member@track-corp.test";

  const [client] = await adminDb
    .insert(schema.clients)
    .values({ slug, name: "Track Corp" })
    .returning();

  const [member] = await adminDb
    .insert(schema.clientMembers)
    .values({ clientId: client!.id, email, role: "viewer" })
    .returning();

  const { raw: linkToken } = await issueMagicLink({
    subjectType: "client_member",
    subjectId: member!.id,
    email,
    clientId: client!.id,
  });

  const result = await verifyMagicLink({ rawToken: linkToken });
  if (!result.ok) throw new Error("verifyMagicLink failed in test setup");

  const raw = result.sessionToken;
  const sessions = await adminDb.query.sessions.findMany({
    where: (s, { eq }) => eq(s.sessionTokenHash, sha256Hex(raw)),
  });
  const session = sessions[0]!;

  return { client: client!, member: member!, session, raw };
}

/**
 * Seed an admin + active session. Returns { admin, session, raw }.
 */
async function seedAdminSession() {
  const { adminDb, schema } = dbModule!;
  const { sha256Hex } = await import("@/lib/utils/hash");
  const { issueMagicLink } = await import("@/lib/auth/issue");
  const { verifyMagicLink } = await import("@/lib/auth/verify");

  const [admin] = await adminDb
    .insert(schema.admins)
    .values({ email: "track-admin@edict.test", name: "Track Admin" })
    .returning();

  const { raw: linkToken } = await issueMagicLink({
    subjectType: "admin",
    subjectId: admin!.id,
    email: "track-admin@edict.test",
    clientId: null,
  });

  const result = await verifyMagicLink({ rawToken: linkToken });
  if (!result.ok) throw new Error("verifyMagicLink failed in test setup");

  const raw = result.sessionToken;
  const sessions = await adminDb.query.sessions.findMany({
    where: (s, { eq }) => eq(s.sessionTokenHash, sha256Hex(raw)),
  });
  const session = sessions[0]!;

  return { admin: admin!, session, raw };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/track/view route", () => {
  // ── Test 1: No session cookie → 401 ─────────────────────────────────────────
  it("no session cookie → 401", async () => {
    const { POST } = await import("@/app/api/track/view/route");

    // cookieJar is empty (cleared in beforeEach)
    const res = await POST(makeRequest({ docId: "doc-123" }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false });
  });

  // ── Test 2: Invalid session token hash → 401 ─────────────────────────────────
  it("invalid session token → 401", async () => {
    const { POST } = await import("@/app/api/track/view/route");
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");

    cookieJar.set(SESSION_COOKIE_NAME, "totally-invalid-token-that-matches-no-hash");

    const res = await POST(makeRequest({ docId: "doc-123" }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false });
  });

  // ── Test 3: Admin session (wrong subjectType) → 401 ──────────────────────────
  // Admins must NOT be able to write doc_viewed beacons. Their views are either
  // tracked separately or not at all in Phase 1. This enforces that invariant.
  it("admin session → 401 (admins cannot write doc_viewed beacons)", async () => {
    const { POST } = await import("@/app/api/track/view/route");
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");
    const { adminDb, schema } = dbModule!;

    const { raw } = await seedAdminSession();
    // Clear audit rows so we can assert nothing was written.
    await adminDb.delete(schema.auditLog);

    cookieJar.set(SESSION_COOKIE_NAME, raw);

    const res = await POST(makeRequest({ docId: "doc-123" }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false });

    // No audit row written.
    const audits = await adminDb.query.auditLog.findMany({});
    expect(audits).toHaveLength(0);
  });

  // ── Test 4: Expired session → 401 ────────────────────────────────────────────
  // Note: a client_member session with null clientId is impossible to create —
  // the schema enforces `sessions_admin_null_client` CHECK constraint AND the
  // `enforce_session_client_id` trigger both block it at the DB level. The
  // `!session.clientId` guard in the route is defense-in-depth against data
  // corruption that the DB guarantees never occurs. Instead, we test the adjacent
  // guard: an expired session token is not found by findActiveSessionByTokenHash
  // and must be rejected with 401.
  it("expired session token → 401", async () => {
    const { POST } = await import("@/app/api/track/view/route");
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");
    const { generateToken } = await import("@/lib/auth/tokens");

    // Seed a member so we have a valid subjectId.
    const [client] = await adminDb
      .insert(schema.clients)
      .values({ slug: "expired-corp", name: "Expired Corp" })
      .returning();
    const [member] = await adminDb
      .insert(schema.clientMembers)
      .values({ clientId: client!.id, email: "exp@expired-corp.test", role: "viewer" })
      .returning();

    // Insert an already-expired session directly so findActiveSessionByTokenHash
    // won't return it (expiresAt is in the past).
    const tok = generateToken(64);
    await adminDb.insert(schema.sessions).values({
      sessionTokenHash: sha256Hex(tok.raw),
      subjectType: "client_member",
      subjectId: member!.id,
      clientId: client!.id,
      expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
      ip: null,
      userAgent: null,
    });

    cookieJar.set(SESSION_COOKIE_NAME, tok.raw);

    const res = await POST(makeRequest({ docId: "doc-123" }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false });
  });

  // ── Test 5: Valid client_member + opened: true → 200 + audit phase=open ───────
  it("valid client_member + opened:true → 200, writes doc_viewed audit with phase=open", async () => {
    const { POST } = await import("@/app/api/track/view/route");
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");
    const { adminDb, schema } = dbModule!;

    const { client, member, raw } = await seedClientMemberSession();

    // Seed an admin so we can satisfy the docs.created_by FK.
    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "doc-creator@edict.test", name: "Doc Creator" })
      .returning();

    const [doc] = await adminDb
      .insert(schema.docs)
      .values({
        slug: "test-doc",
        title: "Test Doc",
        bodyType: "markdown",
        body: "# Hello",
        createdBy: admin!.id,
      })
      .returning();

    // Clear audit rows written during session setup.
    await adminDb.delete(schema.auditLog);

    cookieJar.set(SESSION_COOKIE_NAME, raw);

    const res = await POST(
      makeRequest(
        { docId: doc!.id, opened: true },
        {
          "x-forwarded-for": "203.0.113.45, 10.0.0.1",
          "user-agent": "Mozilla/5.0 (TestBrowser)",
        },
      ),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true });

    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.eventType, "doc_viewed"),
    });
    expect(audits).toHaveLength(1);
    const audit = audits[0]!;

    // Tenant isolation fields
    expect(audit.actorType).toBe("client_member");
    expect(audit.actorId).toBe(member.id);
    expect(audit.clientId).toBe(client.id);
    expect(audit.docId).toBe(doc!.id);

    // Metadata phase
    expect(audit.metadata).toMatchObject({ phase: "open" });

    // IP + UA captured; x-forwarded-for strips to first IP only
    expect(audit.ip).toBe("203.0.113.45");
    expect(audit.userAgent).toBe("Mozilla/5.0 (TestBrowser)");
  });

  // ── Test 6: Valid client_member + duration_ms body → 200 + audit phase=close ─
  it("valid client_member + duration_ms → 200, writes doc_viewed audit with phase=close", async () => {
    const { POST } = await import("@/app/api/track/view/route");
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");
    const { adminDb, schema } = dbModule!;

    const { raw } = await seedClientMemberSession({
      slug: "close-corp",
      email: "m@close-corp.test",
    });

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "close-creator@edict.test", name: "Close Creator" })
      .returning();

    const [doc] = await adminDb
      .insert(schema.docs)
      .values({
        slug: "close-doc",
        title: "Close Doc",
        bodyType: "html",
        body: "<p>Hello</p>",
        createdBy: admin!.id,
      })
      .returning();

    await adminDb.delete(schema.auditLog);

    cookieJar.set(SESSION_COOKIE_NAME, raw);

    const res = await POST(makeRequest({ docId: doc!.id, duration_ms: 45_000 }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true });

    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.eventType, "doc_viewed"),
    });
    expect(audits).toHaveLength(1);
    const audit = audits[0]!;

    // Close phase with duration
    expect(audit.metadata).toMatchObject({ phase: "close", duration_ms: 45_000 });
  });

  // ── Test 7: Missing docId in body → 400 ──────────────────────────────────────
  it("missing docId in body → 400", async () => {
    const { POST } = await import("@/app/api/track/view/route");
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");

    const { raw } = await seedClientMemberSession({
      slug: "missing-corp",
      email: "m@missing-corp.test",
    });
    cookieJar.set(SESSION_COOKIE_NAME, raw);

    // body present but no docId field
    const res = await POST(makeRequest({ opened: true }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false });
  });

  // ── Test 8: Malformed JSON body → 400 (the .catch → null path) ───────────────
  // When the request body is not valid JSON, req.json() throws. The route
  // catches, logs a warning, and returns 400. This exercises that path.
  it("malformed JSON body → 400", async () => {
    const { POST } = await import("@/app/api/track/view/route");
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");

    const { raw } = await seedClientMemberSession({
      slug: "malformed-corp",
      email: "m@malformed-corp.test",
    });
    cookieJar.set(SESSION_COOKIE_NAME, raw);

    // Send a request with invalid JSON body bypassing the makeRequest helper.
    const req = new NextRequest("http://localhost:3000/api/track/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ this is not: valid json }}}",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false });
  });
});
