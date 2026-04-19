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
  await adminDb.delete(schema.clients);
  await adminDb.delete(schema.admins);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/auth/logout", { method: "POST" });
}

/**
 * Seed an admin + active session. Returns { admin, session, raw }
 * where `raw` is the plain-text session token (to stuff into cookieJar).
 */
async function seedAdminSession() {
  const { adminDb, schema } = dbModule!;
  const { sha256Hex } = await import("@/lib/utils/hash");
  const { issueMagicLink } = await import("@/lib/auth/issue");
  const { verifyMagicLink } = await import("@/lib/auth/verify");

  const [admin] = await adminDb
    .insert(schema.admins)
    .values({ email: "logout-admin@edict.test", name: "Logout Admin" })
    .returning();

  const { raw: linkToken } = await issueMagicLink({
    subjectType: "admin",
    subjectId: admin!.id,
    email: "logout-admin@edict.test",
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

/**
 * Seed a client + member + active session. Returns { client, member, session, raw }.
 */
async function seedClientMemberSession() {
  const { adminDb, schema } = dbModule!;
  const { sha256Hex } = await import("@/lib/utils/hash");
  const { issueMagicLink } = await import("@/lib/auth/issue");
  const { verifyMagicLink } = await import("@/lib/auth/verify");

  const [client] = await adminDb
    .insert(schema.clients)
    .values({ slug: "logout-corp", name: "Logout Corp" })
    .returning();

  const [member] = await adminDb
    .insert(schema.clientMembers)
    .values({ clientId: client!.id, email: "member@logout-corp.test", role: "viewer" })
    .returning();

  const { raw: linkToken } = await issueMagicLink({
    subjectType: "client_member",
    subjectId: member!.id,
    email: "member@logout-corp.test",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /auth/logout route", () => {
  // ── Test 1: Active session → revoked + audited + cookie cleared + redirect ──
  it("active session → revoked, audit written, 302 to /, cookie cleared", async () => {
    const { POST } = await import("@/app/(auth)/auth/logout/route");
    const { adminDb } = dbModule!;
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");

    const { admin, session, raw } = await seedAdminSession();

    // Clear the session_created audit written during setup so we can assert
    // exactly on the session_revoked event.
    await adminDb.delete((await import("@/lib/db")).schema.auditLog);

    cookieJar.set(SESSION_COOKIE_NAME, raw);

    const res = await POST(makeRequest());

    // ── Status + Location
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(new URL(location!).pathname).toBe("/");

    // ── Session revoked in DB
    const updatedSession = await adminDb.query.sessions.findFirst({
      where: (s, { eq }) => eq(s.id, session.id),
    });
    expect(updatedSession).toBeDefined();
    expect(updatedSession!.revokedAt).not.toBeNull();

    // ── Audit event written
    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.eventType, "session_revoked"),
    });
    expect(audits).toHaveLength(1);
    const audit = audits[0]!;
    expect(audit.actorType).toBe("admin");
    expect(audit.actorId).toBe(admin.id);
    expect(audit.clientId).toBeNull();
    expect(audit.metadata).toMatchObject({ session_id: session.id, reason: "logout" });

    // ── Cookie cleared: Next emits Set-Cookie with empty value + Max-Age=0 or Expires in past
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    const cookieStr = setCookie!;
    expect(cookieStr).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=`));
    // Must be a delete cookie: either Max-Age=0 or Expires in past
    const hasMaxAge0 = /Max-Age=0/i.test(cookieStr);
    const hasExpiredDate = /Expires=/i.test(cookieStr) && (() => {
      const match = cookieStr.match(/Expires=([^;]+)/i);
      if (!match) return false;
      return new Date(match[1]!).getTime() < Date.now();
    })();
    expect(hasMaxAge0 || hasExpiredDate).toBe(true);
  });

  // ── Test 2: No session cookie → 302 + cookie cleared (idempotent) ──────────
  it("no session cookie → no DB changes, 302 to /, cookie still cleared", async () => {
    const { POST } = await import("@/app/(auth)/auth/logout/route");
    const { adminDb } = dbModule!;

    // cookieJar is empty (reset in beforeEach)
    const auditsBefore = await adminDb.query.auditLog.findMany({});
    const sessionsBefore = await adminDb.query.sessions.findMany({});

    const res = await POST(makeRequest());

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(new URL(location!).pathname).toBe("/");

    // No DB changes
    const auditsAfter = await adminDb.query.auditLog.findMany({});
    const sessionsAfter = await adminDb.query.sessions.findMany({});
    expect(auditsAfter).toHaveLength(auditsBefore.length);
    expect(sessionsAfter).toHaveLength(sessionsBefore.length);

    // Cookie delete still emitted (idempotent cleanup)
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
  });

  // ── Test 3: Unknown/invalid token → no DB changes, 302 + cookie cleared ────
  it("unknown session token → no DB changes, 302, cookie cleared", async () => {
    const { POST } = await import("@/app/(auth)/auth/logout/route");
    const { adminDb } = dbModule!;
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");

    // A random token that won't match any hash in the DB.
    cookieJar.set(SESSION_COOKIE_NAME, "totally-random-invalid-token-xyz-abc-123");

    const auditsBefore = await adminDb.query.auditLog.findMany({});
    const sessionsBefore = await adminDb.query.sessions.findMany({});

    const res = await POST(makeRequest());

    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");

    const auditsAfter = await adminDb.query.auditLog.findMany({});
    const sessionsAfter = await adminDb.query.sessions.findMany({});
    expect(auditsAfter).toHaveLength(auditsBefore.length);
    expect(sessionsAfter).toHaveLength(sessionsBefore.length);

    // Cookie still cleared
    expect(res.headers.get("set-cookie")).not.toBeNull();
  });

  // ── Test 4: Already-revoked session → no second revoke, no new audit ───────
  it("already-revoked session → findActiveSessionByTokenHash returns null, no second revoke or audit", async () => {
    const { POST } = await import("@/app/(auth)/auth/logout/route");
    const { adminDb, schema } = dbModule!;
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");

    const { session, raw } = await seedAdminSession();

    // Manually revoke the session directly in DB.
    await adminDb
      .update(schema.sessions)
      .set({ revokedAt: new Date(Date.now() - 5000) })
      .where((await import("drizzle-orm").then((m) => m.eq))(schema.sessions.id, session.id));

    const revokedAtBefore = (await adminDb.query.sessions.findFirst({
      where: (s, { eq }) => eq(s.id, session.id),
    }))!.revokedAt;

    // Clear audit log written during setup.
    await adminDb.delete(schema.auditLog);

    cookieJar.set(SESSION_COOKIE_NAME, raw);

    const res = await POST(makeRequest());

    expect(res.status).toBe(302);

    // No new audit event.
    const audits = await adminDb.query.auditLog.findMany({});
    expect(audits).toHaveLength(0);

    // revokedAt value is unchanged (no second UPDATE applied).
    const sessionAfter = await adminDb.query.sessions.findFirst({
      where: (s, { eq }) => eq(s.id, session.id),
    });
    expect(sessionAfter!.revokedAt?.getTime()).toBe(revokedAtBefore!.getTime());

    // Cookie still cleared.
    expect(res.headers.get("set-cookie")).not.toBeNull();
  });

  // ── Test 5: Expired session → treated as inactive, no revoke or audit ──────
  it("expired session → findActiveSessionByTokenHash returns null, no revoke or audit", async () => {
    const { POST } = await import("@/app/(auth)/auth/logout/route");
    const { adminDb, schema } = dbModule!;
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");
    const { sha256Hex } = await import("@/lib/utils/hash");
    const { generateToken } = await import("@/lib/auth/tokens");

    // Seed admin first.
    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "expired-session@edict.test", name: "Expired Session Admin" })
      .returning();

    // Insert a session directly with expires_at in the past and revoked_at null.
    const tok = generateToken(64);
    const [expiredSession] = await adminDb
      .insert(schema.sessions)
      .values({
        sessionTokenHash: sha256Hex(tok.raw),
        subjectType: "admin",
        subjectId: admin!.id,
        clientId: null,
        expiresAt: new Date(Date.now() - 60_000), // expired 1 min ago
        ip: null,
        userAgent: null,
      })
      .returning();

    // Clear audit log written during setup.
    await adminDb.delete(schema.auditLog);

    cookieJar.set(SESSION_COOKIE_NAME, tok.raw);

    const res = await POST(makeRequest());

    expect(res.status).toBe(302);

    // No new audit events.
    const audits = await adminDb.query.auditLog.findMany({});
    expect(audits).toHaveLength(0);

    // Session revokedAt remains null (untouched).
    const sessionAfter = await adminDb.query.sessions.findFirst({
      where: (s, { eq }) => eq(s.id, expiredSession!.id),
    });
    expect(sessionAfter!.revokedAt).toBeNull();

    // Cookie still cleared.
    expect(res.headers.get("set-cookie")).not.toBeNull();
  });

  // ── Test 6: client_member session → audit has correct actor_type + client_id ─
  it("client_member session → audit actor_type=client_member, actor_id=member.id, client_id set", async () => {
    const { POST } = await import("@/app/(auth)/auth/logout/route");
    const { adminDb, schema } = dbModule!;
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");

    const { client, member, session, raw } = await seedClientMemberSession();

    // Clear setup audit rows.
    await adminDb.delete(schema.auditLog);

    cookieJar.set(SESSION_COOKIE_NAME, raw);

    const res = await POST(makeRequest());

    expect(res.status).toBe(302);

    // Session revoked.
    const updatedSession = await adminDb.query.sessions.findFirst({
      where: (s, { eq }) => eq(s.id, session.id),
    });
    expect(updatedSession!.revokedAt).not.toBeNull();

    // Audit event with correct tenant-scoped fields.
    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.eventType, "session_revoked"),
    });
    expect(audits).toHaveLength(1);
    const audit = audits[0]!;
    expect(audit.actorType).toBe("client_member");
    expect(audit.actorId).toBe(member.id);
    expect(audit.clientId).toBe(client.id); // not null for client_member sessions
    expect(audit.metadata).toMatchObject({ session_id: session.id, reason: "logout" });
  });

  // ── Test 7: Cookie delete includes Path=/ ────────────────────────────────────
  it("Set-Cookie delete header includes Path=/ so browsers match and clear the session cookie", async () => {
    const { POST } = await import("@/app/(auth)/auth/logout/route");
    const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");

    // Run with or without a valid session — the cookie-delete behavior is
    // independent of session validity.
    const res = await POST(makeRequest());

    expect(res.status).toBe(302);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();

    // Path=/ must be present so the browser matches the session cookie set
    // by /auth/verify (which also uses Path=/). Without it, browsers silently
    // skip the deletion if they stored the original with a different path.
    expect(setCookie).toMatch(/Path=\//i);

    // Confirm it's for the right cookie name.
    expect(setCookie).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=`));
  });
});
