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

describe("GET /auth/verify route", () => {
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

  // ── Test 2: Invalid/unknown token ─────────────────────────────────────────
  it("invalid token → 200 invalid HTML, no cookie, magic_link_failed audit written", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb } = dbModule!;

    const res = await GET(makeRequest("totally-invalid-token-string"));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    // verifyMagicLink writes magic_link_failed for any miss/expired path.
    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.eventType, "magic_link_failed"),
    });
    expect(audits).toHaveLength(1);
  });

  // ── Test 3: Expired token ─────────────────────────────────────────────────
  it("expired token → 200 invalid HTML, no cookie, no session inserted", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");

    // Seed admin so we have a valid subjectId.
    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "expired@edict.test", name: "Expired Admin" })
      .returning();

    // Directly insert a token with expires_at in the past.
    const rawToken = "expired-raw-token-for-test-01";
    await adminDb.insert(schema.magicLinkTokens).values({
      tokenHash: sha256Hex(rawToken),
      subjectType: "admin",
      subjectId: admin!.id,
      email: "expired@edict.test",
      clientId: null,
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    });

    const res = await GET(makeRequest(rawToken));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);
  });

  // ── Test 4: Already-consumed token ────────────────────────────────────────
  it("already-consumed token → 200 invalid HTML, no cookie, no session inserted", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "consumed@edict.test", name: "Consumed Admin" })
      .returning();

    // Directly insert a token that is already consumed.
    const rawToken = "consumed-raw-token-for-test-02";
    await adminDb.insert(schema.magicLinkTokens).values({
      tokenHash: sha256Hex(rawToken),
      subjectType: "admin",
      subjectId: admin!.id,
      email: "consumed@edict.test",
      clientId: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // valid TTL
      consumedAt: new Date(Date.now() - 5000), // already consumed 5s ago
    });

    const res = await GET(makeRequest(rawToken));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);
  });

  // ── Test 5: Valid admin token ──────────────────────────────────────────────
  it("valid admin token → 302 to /admin, session cookie set, session row inserted, token consumed", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
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

    const res = await GET(makeRequest(raw));

    // Redirect assertions.
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(location).toMatch(/\/admin$/);

    // Cookie assertions.
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).not.toBeNull();
    expect(cookie).toMatch(/edict_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/);
    // NODE_ENV !== "production" in tests — Secure flag must NOT be present.
    expect(cookie).not.toMatch(/;\s*Secure/i);

    // Session row inserted.
    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.subjectType).toBe("admin");
    expect(session.subjectId).toBe(admin!.id);
    expect(session.clientId).toBeNull();

    // Verify session token hash matches.
    const sessionTokenInCookie = cookie.split("edict_session=")[1]!.split(";")[0]!;
    expect(session.sessionTokenHash).toBe(sha256Hex(sessionTokenInCookie));

    // Magic link token consumed.
    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.consumedAt).not.toBeNull();
  });

  // ── Test 6: Valid client_member token ─────────────────────────────────────
  it("valid client_member token → 302 to /c/<slug>, session cookie set, session row inserted", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
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

    const res = await GET(makeRequest(raw));

    // Redirect assertions.
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(location).toMatch(/\/c\/acme-corp$/);

    // Cookie set.
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).not.toBeNull();
    expect(cookie).toMatch(/edict_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);

    // Session row inserted with correct tenant scope.
    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.subjectType).toBe("client_member");
    expect(session.subjectId).toBe(member!.id);
    expect(session.clientId).toBe(client!.id);

    // Verify session token hash matches cookie value.
    const sessionTokenInCookie = cookie.split("edict_session=")[1]!.split(";")[0]!;
    expect(session.sessionTokenHash).toBe(sha256Hex(sessionTokenInCookie));
  });

  // ── Test 7: Client deleted mid-flow → verifyMagicLink FK-throws, caught by try/catch wrap
  it("client deleted after token issued → verifyMagicLink FK-throws, caught by try/catch, renderInvalid", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
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

    // Delete the client row via an FK bypass. Production invariant: clients are
    // only deleted through paths that respect FK constraints (none exist in
    // Phase 1). This test simulates the edge case anyway to verify the route's
    // try/catch wrap (added at 2dade5a) handles the thrown FK violation from
    // verifyMagicLink.insertSession without crashing the handler.
    //
    // The route's own `if (!client) return renderInvalid()` branch is NEVER
    // reached here — insertSession throws before returning to the route. That
    // branch is defensive; see the comment in route.ts above it.
    //
    // Pin the session_replication_role toggle to a single pool connection so
    // the replica→origin reset is colocated with the DELETE and can't leak
    // replica mode to another pool connection.
    const conn = await superPool!.connect();
    try {
      await conn.query("SET session_replication_role = 'replica'");
      await conn.query("DELETE FROM clients WHERE id = $1", [client!.id]);
      await conn.query("SET session_replication_role = 'origin'");
    } finally {
      conn.release();
    }

    const res = await GET(makeRequest(raw));

    // verifyMagicLink threw during insertSession → try/catch caught it → renderInvalid returned.
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    // No session was created.
    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);
  });

  // ── Test 8: IP + User-Agent capture ───────────────────────────────────────
  it("valid admin token with X-Forwarded-For + User-Agent → session row captures first IP + UA", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
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

    const res = await GET(
      makeRequest(raw, {
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
});
