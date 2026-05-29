/**
 * Integration tests for the admin write Route Handlers (app/api/admin/**).
 *
 * These handlers replace <form action={serverAction}> for the admin write
 * actions, which throw "Connection closed." in the Next.js 16 Server Action
 * streaming layer on Vercel Functions. Each handler parses the form body, calls
 * the (unchanged) admin action, and owns an explicit 303 redirect.
 *
 * Approach: exercise the REAL chain end-to-end — handler → action →
 * requireAdminSession (cookies + session lookup) → getContext (ALS) → DB → 303.
 * This is the migration's core risk: that the admin auth + context machinery
 * works inside a Route Handler, not just a Server Action. So unlike the action
 * unit tests, requireAdminSession is NOT mocked here; a real admin session is
 * seeded (issue + verify magic link) and injected via a mocked cookie jar.
 *
 * - Real DB via @testcontainers/postgresql
 * - next/headers cookies mocked to inject the seeded session token
 * - next/cache revalidatePath mocked (no request scope in tests)
 * - DEV_PRINT_MAGIC_LINKS=true + no RESEND_API_KEY → sendMail dev-prints
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import type * as DbModule from "@/lib/db";

// ---------------------------------------------------------------------------
// Mocks — declared before any module that imports them.
// ---------------------------------------------------------------------------

// requireAdminSession reads the session cookie via cookies(); inject it here.
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

// The admin actions call revalidatePath, which has no request scope in tests.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
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

  // Force dev-print mode: no Resend, no real emails (read at mail module load).
  process.env.DEV_PRINT_MAGIC_LINKS = "true";
  delete process.env.RESEND_API_KEY;

  const host = pg.getHost();
  const port = pg.getMappedPort(5432);
  process.env.DATABASE_URL = `postgres://edict_app:dev@${host}:${port}/edict`;
  process.env.DATABASE_ADMIN_URL = pg.getConnectionUri();
  process.env.APP_URL = "http://localhost:3000";

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
  cookieJar.clear();
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  // FK-safe order.
  await adminDb.delete(schema.rateLimitEvents);
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

const ORIGIN = "http://localhost:3000";

function formRequest(path: string, fields: Record<string, string>): NextRequest {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new NextRequest(`${ORIGIN}${path}`, { method: "POST", body: fd });
}

/** Seed an admin + active session; returns { admin, raw } (raw session token). */
async function seedAdminSession() {
  const { adminDb, schema } = dbModule!;
  const { issueMagicLink } = await import("@/lib/auth/issue");
  const { verifyMagicLink } = await import("@/lib/auth/verify");

  const [admin] = await adminDb
    .insert(schema.admins)
    .values({ email: "admin@edict.test", name: "Admin" })
    .returning();

  const { raw: linkToken } = await issueMagicLink({
    subjectType: "admin",
    subjectId: admin!.id,
    email: "admin@edict.test",
    clientId: null,
  });
  const result = await verifyMagicLink({ rawToken: linkToken });
  if (!result.ok) throw new Error("seed admin session failed");

  return { admin: admin!, raw: result.sessionToken };
}

/** Seed a client_member + active session; returns { client, member, raw }. */
async function seedClientMemberSession() {
  const { adminDb, schema } = dbModule!;
  const { issueMagicLink } = await import("@/lib/auth/issue");
  const { verifyMagicLink } = await import("@/lib/auth/verify");

  const [client] = await adminDb
    .insert(schema.clients)
    .values({ slug: "member-co", name: "Member Co" })
    .returning();
  const [member] = await adminDb
    .insert(schema.clientMembers)
    .values({ clientId: client!.id, email: "member@member-co.test", role: "viewer" })
    .returning();

  const { raw: linkToken } = await issueMagicLink({
    subjectType: "client_member",
    subjectId: member!.id,
    email: "member@member-co.test",
    clientId: client!.id,
  });
  const result = await verifyMagicLink({ rawToken: linkToken });
  if (!result.ok) throw new Error("seed member session failed");

  return { client: client!, member: member!, raw: result.sessionToken };
}

async function loginAs(raw: string) {
  const { SESSION_COOKIE_NAME } = await import("@/lib/auth/middleware");
  cookieJar.set(SESSION_COOKIE_NAME, raw);
}

// ---------------------------------------------------------------------------
// Happy-path tests — one per handler
// ---------------------------------------------------------------------------

describe("admin write Route Handlers (authenticated admin)", () => {
  it("POST /api/admin/clients creates a client and 303s to its slug page", async () => {
    const { raw } = await seedAdminSession();
    await loginAs(raw);

    const { POST } = await import("@/app/api/admin/clients/route");
    const res = await POST(formRequest("/api/admin/clients", { slug: "acme", name: "Acme Inc" }));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin/clients/acme`);

    const { adminDb, schema } = dbModule!;
    const clients = await adminDb.select().from(schema.clients);
    expect(clients).toHaveLength(1);
    expect(clients[0]!.slug).toBe("acme");
    expect(clients[0]!.name).toBe("Acme Inc");
  });

  it("POST /api/admin/clients/[slug]/members adds a member and 303s to the client page", async () => {
    const { raw } = await seedAdminSession();
    await loginAs(raw);

    const { adminDb, schema } = dbModule!;
    const [client] = await adminDb
      .insert(schema.clients)
      .values({ slug: "acme", name: "Acme" })
      .returning();

    const { POST } = await import("@/app/api/admin/clients/[slug]/members/route");
    const res = await POST(
      formRequest("/api/admin/clients/acme/members", {
        clientId: client!.id,
        email: "m@acme.test",
        role: "viewer",
      }),
      { params: Promise.resolve({ slug: "acme" }) },
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin/clients/acme`);

    const members = await adminDb.select().from(schema.clientMembers);
    expect(members).toHaveLength(1);
    expect(members[0]!.email).toBe("m@acme.test");
  });

  it("POST /api/admin/clients/[slug]/members/revoke revokes a member and 303s to the client page", async () => {
    const { raw } = await seedAdminSession();
    await loginAs(raw);

    const { adminDb, schema } = dbModule!;
    const [client] = await adminDb
      .insert(schema.clients)
      .values({ slug: "acme", name: "Acme" })
      .returning();
    const [member] = await adminDb
      .insert(schema.clientMembers)
      .values({ clientId: client!.id, email: "m@acme.test", role: "viewer" })
      .returning();

    const { POST } = await import("@/app/api/admin/clients/[slug]/members/revoke/route");
    const res = await POST(
      formRequest("/api/admin/clients/acme/members/revoke", {
        memberId: member!.id,
        clientId: client!.id,
      }),
      { params: Promise.resolve({ slug: "acme" }) },
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin/clients/acme`);

    const [revoked] = await adminDb
      .select()
      .from(schema.clientMembers)
      .where(eq(schema.clientMembers.id, member!.id));
    expect(revoked!.revokedAt).not.toBeNull();
  });

  it("POST /api/admin/docs creates a doc and 303s to its edit page", async () => {
    const { raw } = await seedAdminSession();
    await loginAs(raw);

    const { POST } = await import("@/app/api/admin/docs/route");
    const res = await POST(
      formRequest("/api/admin/docs", {
        slug: "the-plan",
        title: "The Plan",
        bodyType: "markdown",
        body: "# Hello",
      }),
    );

    expect(res.status).toBe(303);

    const { adminDb, schema } = dbModule!;
    const docs = await adminDb.select().from(schema.docs);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.slug).toBe("the-plan");
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin/docs/${docs[0]!.id}`);
  });

  it("POST /api/admin/docs/[id] updates a doc and 303s to its edit page", async () => {
    const { admin, raw } = await seedAdminSession();
    await loginAs(raw);

    const { adminDb, schema } = dbModule!;
    const [doc] = await adminDb
      .insert(schema.docs)
      .values({
        slug: "the-plan",
        title: "Old Title",
        bodyType: "html",
        body: "<p>old</p>",
        createdBy: admin.id,
      })
      .returning();

    const { POST } = await import("@/app/api/admin/docs/[id]/route");
    const res = await POST(
      formRequest(`/api/admin/docs/${doc!.id}`, {
        id: doc!.id,
        title: "New Title",
        body: "<p>new</p>",
        bodyType: "html",
      }),
      { params: Promise.resolve({ id: doc!.id }) },
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin/docs/${doc!.id}`);

    const [updated] = await adminDb.select().from(schema.docs).where(eq(schema.docs.id, doc!.id));
    expect(updated!.title).toBe("New Title");
    expect(updated!.body).toBe("<p>new</p>");
  });

  it("POST /api/admin/docs/[id]/share shares a doc and 303s to the share page", async () => {
    const { admin, raw } = await seedAdminSession();
    await loginAs(raw);

    const { adminDb, schema } = dbModule!;
    const [client] = await adminDb
      .insert(schema.clients)
      .values({ slug: "acme", name: "Acme" })
      .returning();
    const [doc] = await adminDb
      .insert(schema.docs)
      .values({
        slug: "the-plan",
        title: "Plan",
        bodyType: "html",
        body: "<p>x</p>",
        createdBy: admin.id,
      })
      .returning();

    const { POST } = await import("@/app/api/admin/docs/[id]/share/route");
    const res = await POST(
      formRequest(`/api/admin/docs/${doc!.id}/share`, {
        docId: doc!.id,
        clientId: client!.id,
        emails: "client@acme.test",
      }),
      { params: Promise.resolve({ id: doc!.id }) },
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin/docs/${doc!.id}/share`);

    const shares = await adminDb.select().from(schema.docShares);
    expect(shares).toHaveLength(1);
    expect(shares[0]!.clientId).toBe(client!.id);
    expect(shares[0]!.revokedAt).toBeNull();
  });

  it("POST /api/admin/docs/[id]/share/revoke unshares a doc and 303s to the share page", async () => {
    const { admin, raw } = await seedAdminSession();
    await loginAs(raw);

    const { adminDb, schema } = dbModule!;
    const [client] = await adminDb
      .insert(schema.clients)
      .values({ slug: "acme", name: "Acme" })
      .returning();
    const [doc] = await adminDb
      .insert(schema.docs)
      .values({
        slug: "the-plan",
        title: "Plan",
        bodyType: "html",
        body: "<p>x</p>",
        createdBy: admin.id,
      })
      .returning();
    await adminDb.insert(schema.docShares).values({ docId: doc!.id, clientId: client!.id });

    const { POST } = await import("@/app/api/admin/docs/[id]/share/revoke/route");
    const res = await POST(
      formRequest(`/api/admin/docs/${doc!.id}/share/revoke`, {
        docId: doc!.id,
        clientId: client!.id,
      }),
      { params: Promise.resolve({ id: doc!.id }) },
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin/docs/${doc!.id}/share`);

    const [share] = await adminDb
      .select()
      .from(schema.docShares)
      .where(eq(schema.docShares.docId, doc!.id));
    expect(share!.revokedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Auth boundary — admin-only enforcement must survive the Route Handler move.
// ---------------------------------------------------------------------------

describe("admin write Route Handlers (auth boundary)", () => {
  it("rejects an unauthenticated POST and writes nothing", async () => {
    // cookieJar is empty (cleared in beforeEach) → requireAdminSession redirects.
    const { POST } = await import("@/app/api/admin/clients/route");
    await expect(
      POST(formRequest("/api/admin/clients", { slug: "nope", name: "Nope" })),
    ).rejects.toThrow();

    const { adminDb, schema } = dbModule!;
    const clients = await adminDb.select().from(schema.clients);
    expect(clients).toHaveLength(0);
  });

  it("rejects a client_member session POST and writes nothing", async () => {
    const { raw } = await seedClientMemberSession();
    await loginAs(raw);

    const { POST } = await import("@/app/api/admin/clients/route");
    await expect(
      POST(formRequest("/api/admin/clients", { slug: "nope", name: "Nope" })),
    ).rejects.toThrow();

    // The only client is the one seeded for the member session; no new one created.
    const { adminDb, schema } = dbModule!;
    const clients = await adminDb.select().from(schema.clients);
    expect(clients.map((c) => c.slug)).not.toContain("nope");
  });
});
