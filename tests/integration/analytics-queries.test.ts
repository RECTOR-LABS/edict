import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type { docAnalytics, recentAuditLog } from "@/lib/db/queries/analytics";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let queries: {
  docAnalytics: typeof docAnalytics;
  recentAuditLog: typeof recentAuditLog;
};

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

  dbModule = await import("@/lib/db");
  queries = await import("@/lib/db/queries/analytics");
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

// Truncate in FK-safe order before each test.
// auditLog → docShares → clientMembers → docs → clients → admins
beforeEach(async () => {
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  await adminDb.delete(schema.auditLog);
  await adminDb.delete(schema.docShares);
  await adminDb.delete(schema.clientMembers);
  await adminDb.delete(schema.docs);
  await adminDb.delete(schema.clients);
  await adminDb.delete(schema.admins);
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
      body: "<p>test</p>",
      createdBy,
    })
    .returning();
  if (!row) throw new Error("seed doc failed");
  return row;
}

async function seedMember(clientId: string, email: string) {
  const { adminDb, schema } = dbModule!;
  const [row] = await adminDb
    .insert(schema.clientMembers)
    .values({ clientId, email, role: "viewer" })
    .returning();
  if (!row) throw new Error("seed member failed");
  return row;
}

async function seedAuditEvent(opts: {
  eventType: string;
  actorId?: string | null;
  docId?: string | null;
  clientId?: string | null;
  createdAt?: Date;
}) {
  const { adminDb, schema } = dbModule!;
  const [row] = await adminDb
    .insert(schema.auditLog)
    .values({
      eventType: opts.eventType,
      actorType: "client_member",
      actorId: opts.actorId ?? null,
      clientId: opts.clientId ?? null,
      docId: opts.docId ?? null,
      metadata: {},
      // Override createdAt if supplied — Drizzle allows passing it directly since
      // defaultNow() is a DB default, not a forced NOT NULL constraint on insert.
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  if (!row) throw new Error("seed audit event failed");
  return row;
}

// ---------------------------------------------------------------------------
// docAnalytics()
// ---------------------------------------------------------------------------

describe("docAnalytics()", () => {
  it("returns zeros and empty byMember when there are no events for the doc", async () => {
    const admin = await seedAdmin();
    const doc = await seedDoc(admin.id, "no-events-doc");

    const { totals, byMember } = await queries.docAnalytics(doc.id);

    expect(totals.views).toBe(0);
    expect(totals.uniqueViewers).toBe(0);
    expect(byMember).toHaveLength(0);
  });

  it("counts 5 views and 3 unique viewers across multiple members", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("multi-view-client");
    const doc = await seedDoc(admin.id, "multi-view-doc");
    const memberA = await seedMember(client.id, "a@edict.test");
    const memberB = await seedMember(client.id, "b@edict.test");
    const memberC = await seedMember(client.id, "c@edict.test");

    // 5 events: a=2, b=2, c=1
    await seedAuditEvent({ eventType: "doc_viewed", actorId: memberA.id, docId: doc.id, clientId: client.id });
    await seedAuditEvent({ eventType: "doc_viewed", actorId: memberA.id, docId: doc.id, clientId: client.id });
    await seedAuditEvent({ eventType: "doc_viewed", actorId: memberB.id, docId: doc.id, clientId: client.id });
    await seedAuditEvent({ eventType: "doc_viewed", actorId: memberB.id, docId: doc.id, clientId: client.id });
    await seedAuditEvent({ eventType: "doc_viewed", actorId: memberC.id, docId: doc.id, clientId: client.id });

    const { totals, byMember } = await queries.docAnalytics(doc.id);

    expect(totals.views).toBe(5);
    expect(totals.uniqueViewers).toBe(3);
    expect(byMember).toHaveLength(3);

    // Ordered by views desc: a(2), b(2), c(1) — top count must be 2.
    expect(byMember[0]!.views).toBe(2);
    expect(byMember[1]!.views).toBe(2);
    expect(byMember[2]!.views).toBe(1);

    // Total of all per-member rows must equal overall view count.
    const sumOfRows = byMember.reduce((acc, r) => acc + r.views, 0);
    expect(sumOfRows).toBe(5);
  });

  it("excludes events for a different doc — other doc's views not counted", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("scope-client");
    const docX = await seedDoc(admin.id, "doc-x");
    const docY = await seedDoc(admin.id, "doc-y");
    const member = await seedMember(client.id, "scope@edict.test");

    // Only seed events for docY.
    await seedAuditEvent({ eventType: "doc_viewed", actorId: member.id, docId: docY.id, clientId: client.id });
    await seedAuditEvent({ eventType: "doc_viewed", actorId: member.id, docId: docY.id, clientId: client.id });

    const { totals, byMember } = await queries.docAnalytics(docX.id);

    expect(totals.views).toBe(0);
    expect(totals.uniqueViewers).toBe(0);
    expect(byMember).toHaveLength(0);
  });

  it("excludes non-doc_viewed events even when docId matches", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("non-viewed-client");
    const doc = await seedDoc(admin.id, "non-viewed-doc");
    const member = await seedMember(client.id, "nonviewed@edict.test");

    // Seed a doc_shared event — should NOT count toward views.
    await seedAuditEvent({ eventType: "doc_shared", actorId: member.id, docId: doc.id, clientId: client.id });

    const { totals, byMember } = await queries.docAnalytics(doc.id);

    expect(totals.views).toBe(0);
    expect(totals.uniqueViewers).toBe(0);
    expect(byMember).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// recentAuditLog()
// ---------------------------------------------------------------------------

describe("recentAuditLog()", () => {
  it("returns an empty array when the log is empty", async () => {
    const rows = await queries.recentAuditLog();
    expect(rows).toHaveLength(0);
  });

  it("returns events in descending createdAt order", async () => {
    const admin = await seedAdmin();
    const doc = await seedDoc(admin.id, "order-doc");

    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-01-02T00:00:00Z");
    const t3 = new Date("2026-01-03T00:00:00Z");

    const e1 = await seedAuditEvent({ eventType: "doc_viewed", docId: doc.id, createdAt: t1 });
    const e2 = await seedAuditEvent({ eventType: "doc_viewed", docId: doc.id, createdAt: t2 });
    const e3 = await seedAuditEvent({ eventType: "doc_viewed", docId: doc.id, createdAt: t3 });

    const rows = await queries.recentAuditLog();

    expect(rows).toHaveLength(3);
    // Newest first.
    expect(rows[0]!.id).toBe(e3.id);
    expect(rows[1]!.id).toBe(e2.id);
    expect(rows[2]!.id).toBe(e1.id);
  });

  it("filters by eventType when provided — returns only matching events", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("filter-client");
    const doc = await seedDoc(admin.id, "filter-doc");
    const member = await seedMember(client.id, "filter@edict.test");

    await seedAuditEvent({ eventType: "doc_viewed", actorId: member.id, docId: doc.id, clientId: client.id });
    await seedAuditEvent({ eventType: "doc_viewed", actorId: member.id, docId: doc.id, clientId: client.id });
    await seedAuditEvent({ eventType: "doc_shared", actorId: member.id, docId: doc.id, clientId: client.id });
    await seedAuditEvent({ eventType: "doc_shared", actorId: member.id, docId: doc.id, clientId: client.id });

    const rows = await queries.recentAuditLog(50, "doc_shared");

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.eventType).toBe("doc_shared");
    }
  });

  it("honours the limit parameter — returns at most N rows", async () => {
    const admin = await seedAdmin();
    const doc = await seedDoc(admin.id, "limit-doc");

    // Seed 5 events.
    for (let i = 0; i < 5; i++) {
      await seedAuditEvent({ eventType: "doc_viewed", docId: doc.id });
    }

    const rows = await queries.recentAuditLog(2);

    expect(rows).toHaveLength(2);
  });
});
