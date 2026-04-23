import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import type * as DbModule from "@/lib/db";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
// Superuser pool — used in test 7 to delete around FK constraints.
let superPool: Pool | undefined;

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

  // Dynamic import AFTER env vars are set.
  dbModule = await import("@/lib/db");

  // Superuser pool kept open for FK-bypass operations in tests (e.g. test 7).
  superPool = new Pool({ connectionString: pg.getConnectionUri() });
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await superPool?.end().catch(() => {});
  await pg?.stop();
});

beforeEach(async () => {
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  await adminDb.delete(schema.auditLog);
  await adminDb.delete(schema.magicLinkTokens);
  await adminDb.delete(schema.sessions);
  await adminDb.delete(schema.clientMembers);
  await adminDb.delete(schema.clients);
  await adminDb.delete(schema.admins);
});

function makeRequest(token: string | null, headers: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/auth/verify");
  if (token !== null) url.searchParams.set("token", token);
  return new NextRequest(url, { headers });
}

function makePostRequest(token: string | null, headers: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/auth/verify");
  const body = new URLSearchParams();
  if (token !== null) body.set("token", token);
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: body.toString(),
  });
}

describe("/auth/verify route", () => {
  // ── Test 1: Missing token ──────────────────────────────────────────────────
  it("missing token → 200 invalid HTML, no cookie", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
    const res = await GET(makeRequest(null));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  // ── Test 2: Invalid/unknown token via POST ────────────────────────────────
  it("POST with invalid token → 200 invalid HTML, no cookie, magic_link_failed audit written", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb } = dbModule!;

    const res = await POST(makePostRequest("totally-invalid-token-string"));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.eventType, "magic_link_failed"),
    });
    expect(audits).toHaveLength(1);
  });

  // ── Test 3: Expired token via POST ────────────────────────────────────────
  it("POST with expired token → 200 invalid HTML, no cookie, no session inserted", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "expired@edict.test", name: "Expired Admin" })
      .returning();

    const rawToken = "expired-raw-token-for-test-01";
    await adminDb.insert(schema.magicLinkTokens).values({
      tokenHash: sha256Hex(rawToken),
      subjectType: "admin",
      subjectId: admin!.id,
      email: "expired@edict.test",
      clientId: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await POST(makePostRequest(rawToken));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);
  });

  // ── Test 4: Already-consumed token via POST ───────────────────────────────
  it("POST with already-consumed token → 200 invalid HTML, no cookie, no session inserted", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "consumed@edict.test", name: "Consumed Admin" })
      .returning();

    const rawToken = "consumed-raw-token-for-test-02";
    await adminDb.insert(schema.magicLinkTokens).values({
      tokenHash: sha256Hex(rawToken),
      subjectType: "admin",
      subjectId: admin!.id,
      email: "consumed@edict.test",
      clientId: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      consumedAt: new Date(Date.now() - 5000),
    });

    const res = await POST(makePostRequest(rawToken));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);
  });

  // ── Test 5: Valid admin token via POST ────────────────────────────────────
  it("POST with valid admin token → 302 to /admin, session cookie set, session row inserted, token consumed", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");
    const { issueMagicLink } = await import("@/lib/auth/issue");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "admin@edict.test", name: "Admin" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "admin",
      subjectId: admin!.id,
      email: "admin@edict.test",
      clientId: null,
    });

    const res = await POST(makePostRequest(raw));

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(location).toMatch(/\/admin$/);

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).not.toBeNull();
    expect(cookie).toMatch(/edict_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).not.toMatch(/;\s*Secure/i);

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.subjectType).toBe("admin");
    expect(session.subjectId).toBe(admin!.id);
    expect(session.clientId).toBeNull();

    const sessionTokenInCookie = cookie.split("edict_session=")[1]!.split(";")[0]!;
    expect(session.sessionTokenHash).toBe(sha256Hex(sessionTokenInCookie));

    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.consumedAt).not.toBeNull();
  });

  // ── Test 6: Valid client_member token via POST ────────────────────────────
  it("POST with valid client_member token → 302 to /c/<slug>, session cookie set, session row inserted", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");
    const { issueMagicLink } = await import("@/lib/auth/issue");

    const [client] = await adminDb
      .insert(schema.clients)
      .values({ slug: "acme-corp", name: "Acme Corp" })
      .returning();

    const [member] = await adminDb
      .insert(schema.clientMembers)
      .values({ clientId: client!.id, email: "alice@acme.test", role: "viewer" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "client_member",
      subjectId: member!.id,
      email: "alice@acme.test",
      clientId: client!.id,
    });

    const res = await POST(makePostRequest(raw));

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(location).toMatch(/\/c\/acme-corp$/);

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).not.toBeNull();
    expect(cookie).toMatch(/edict_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.subjectType).toBe("client_member");
    expect(session.subjectId).toBe(member!.id);
    expect(session.clientId).toBe(client!.id);

    const sessionTokenInCookie = cookie.split("edict_session=")[1]!.split(";")[0]!;
    expect(session.sessionTokenHash).toBe(sha256Hex(sessionTokenInCookie));
  });

  // ── Test 7: Client deleted mid-flow via POST → FK-throws, caught by try/catch
  it("POST: client deleted after token issued → verifyMagicLink FK-throws, caught by try/catch, renderInvalid", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { issueMagicLink } = await import("@/lib/auth/issue");

    const [client] = await adminDb
      .insert(schema.clients)
      .values({ slug: "ghost-co", name: "Ghost Co" })
      .returning();

    const [member] = await adminDb
      .insert(schema.clientMembers)
      .values({ clientId: client!.id, email: "ghost@ghost-co.test", role: "viewer" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "client_member",
      subjectId: member!.id,
      email: "ghost@ghost-co.test",
      clientId: client!.id,
    });

    const conn = await superPool!.connect();
    try {
      await conn.query("SET session_replication_role = 'replica'");
      await conn.query("DELETE FROM clients WHERE id = $1", [client!.id]);
      await conn.query("SET session_replication_role = 'origin'");
    } finally {
      conn.release();
    }

    const res = await POST(makePostRequest(raw));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);
  });

  // ── Test 8: IP + User-Agent capture via POST ──────────────────────────────
  it("POST with X-Forwarded-For + User-Agent → session row captures first IP + UA", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { issueMagicLink } = await import("@/lib/auth/issue");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "iptest@edict.test", name: "IP Test Admin" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "admin",
      subjectId: admin!.id,
      email: "iptest@edict.test",
      clientId: null,
    });

    const res = await POST(
      makePostRequest(raw, {
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        "user-agent": "test-agent/1.0",
      }),
    );

    expect(res.status).toBe(302);

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.ip).toBe("1.2.3.4");
    expect(session.userAgent).toBe("test-agent/1.0");
  });

  // ── Test 9: Revoked member token via POST ─────────────────────────────────
  it("POST with revoked member token → 200 invalid HTML, no cookie, no session, magic_link_failed audit written", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { issueMagicLink } = await import("@/lib/auth/issue");
    const { eq } = await import("drizzle-orm");

    const [client] = await adminDb
      .insert(schema.clients)
      .values({ slug: "revoke-test-co", name: "Revoke Test Co" })
      .returning();

    const [member] = await adminDb
      .insert(schema.clientMembers)
      .values({ clientId: client!.id, email: "revoked@revoke-test.test", role: "viewer" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "client_member",
      subjectId: member!.id,
      email: "revoked@revoke-test.test",
      clientId: client!.id,
    });

    await adminDb
      .update(schema.clientMembers)
      .set({ revokedAt: new Date() })
      .where(eq(schema.clientMembers.id, member!.id));

    const res = await POST(makePostRequest(raw));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);

    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq: eqFn }) => eqFn(a.eventType, "magic_link_failed"),
    });
    expect(audits).toHaveLength(1);
    expect((audits[0]!.metadata as Record<string, unknown>)["reason"]).toBe("member_revoked");
  });

  // ── Test 10: GET renders landing page without consuming token (SCANNER-SAFE) ─
  it("GET with valid token → 200 continue-landing HTML, token NOT consumed in DB, no cookie, no session inserted", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { issueMagicLink } = await import("@/lib/auth/issue");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "scanner@edict.test", name: "Scanner Admin" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "admin",
      subjectId: admin!.id,
      email: "scanner@edict.test",
      clientId: null,
    });

    const res = await GET(makeRequest(raw));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toMatch(/<form[^>]+method=["']post["'][^>]*>/i);
    expect(body).toContain(`value="${raw}"`);
    expect(body).toMatch(/continue|sign in/i);

    expect(res.headers.get("set-cookie")).toBeNull();

    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.consumedAt).toBeNull();

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);

    const audits = await adminDb.query.auditLog.findMany({});
    // issueMagicLink wrote one magic_link_sent row; GET must add none.
    expect(audits).toHaveLength(1);
    expect(audits[0]!.eventType).toBe("magic_link_sent");
  });

  // ── Test 11: GET with invalid token → landing page, NO audit (GET is DB-free)
  it("GET with unknown/invalid token → 200 landing HTML, NO audit row written (GET performs zero DB work)", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb } = dbModule!;

    const res = await GET(makeRequest("totally-invalid-token-string"));

    expect(res.status).toBe(200);
    const body = await res.text();
    // GET is dumb — it renders the continue page regardless of token validity.
    // POST is where validation happens. This is the scanner-safe invariant.
    expect(body).toMatch(/<form[^>]+method=["']post["'][^>]*>/i);
    expect(body).toContain('value="totally-invalid-token-string"');

    // Critical: zero DB touch → zero audit rows.
    const audits = await adminDb.query.auditLog.findMany({});
    expect(audits).toHaveLength(0);
  });

  // ── Test 12: GET with consumed token → landing page still renders ─────────
  it("GET with already-consumed token → 200 landing HTML, does not re-consume or error", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "double-scan@edict.test", name: "Double Scan" })
      .returning();

    const rawToken = "already-consumed-raw-token";
    await adminDb.insert(schema.magicLinkTokens).values({
      tokenHash: sha256Hex(rawToken),
      subjectType: "admin",
      subjectId: admin!.id,
      email: "double-scan@edict.test",
      clientId: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      consumedAt: new Date(Date.now() - 1000),
    });

    const res = await GET(makeRequest(rawToken));

    // GET renders the same landing page regardless of token state — zero DB
    // read or write. The user will see "This link is no longer valid" only
    // after clicking Continue (POST handles validation).
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<form[^>]+method=["']post["'][^>]*>/i);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  // ── Test 13: POST with missing token → invalid page ───────────────────────
  it("POST without token → 200 invalid HTML, no cookie", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const res = await POST(makePostRequest(null));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
