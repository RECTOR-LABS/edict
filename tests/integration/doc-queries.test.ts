import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type {
  listDocs,
  createDoc,
  updateDoc,
  getDocById,
  listDocsForClient,
  getDocForClient,
} from "@/lib/db/queries/docs";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let queries: {
  listDocs: typeof listDocs;
  createDoc: typeof createDoc;
  updateDoc: typeof updateDoc;
  getDocById: typeof getDocById;
  listDocsForClient: typeof listDocsForClient;
  getDocForClient: typeof getDocForClient;
};

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

  // Dynamic imports AFTER env is set.
  dbModule = await import("@/lib/db");
  queries = await import("@/lib/db/queries/docs");
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

// Truncate in FK-safe order before each test.
// doc_shares → docs → admins + clients (independently; no FK between admins and clients).
beforeEach(async () => {
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  await adminDb.delete(schema.docShares);
  await adminDb.delete(schema.docs);
  await adminDb.delete(schema.admins);
  await adminDb.delete(schema.clients);
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

async function seedDoc(
  createdBy: string,
  overrides: {
    slug?: string;
    title?: string;
    bodyType?: "html" | "markdown";
    body?: string;
    updatedAt?: Date;
  } = {},
) {
  const { adminDb, schema } = dbModule!;
  const slug = overrides.slug ?? `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [row] = await adminDb
    .insert(schema.docs)
    .values({
      slug,
      title: overrides.title ?? "Test Doc",
      bodyType: overrides.bodyType ?? "html",
      body: overrides.body ?? "<p>hello</p>",
      createdBy,
      updatedAt: overrides.updatedAt ?? new Date(),
    })
    .returning();
  if (!row) throw new Error("seed doc failed");
  return row;
}

async function seedShare(
  docId: string,
  clientId: string,
  overrides: { sharedAt?: Date; revokedAt?: Date | null } = {},
) {
  const { adminDb, schema } = dbModule!;
  const [row] = await adminDb
    .insert(schema.docShares)
    .values({
      docId,
      clientId,
      sharedAt: overrides.sharedAt ?? new Date(),
      revokedAt: overrides.revokedAt ?? null,
    })
    .returning();
  if (!row) throw new Error("seed share failed");
  return row;
}

// ---------------------------------------------------------------------------
// listDocs()
// ---------------------------------------------------------------------------

describe("listDocs()", () => {
  it("returns [] when no docs exist", async () => {
    const rows = await queries.listDocs();
    expect(rows).toEqual([]);
  });

  it("orders results descending by updatedAt (most-recently-updated first)", async () => {
    const admin = await seedAdmin();
    await seedDoc(admin.id, {
      slug: "doc-oldest",
      title: "Oldest",
      updatedAt: new Date("2025-01-01T00:00:00Z"),
    });
    await seedDoc(admin.id, {
      slug: "doc-middle",
      title: "Middle",
      updatedAt: new Date("2025-06-01T00:00:00Z"),
    });
    await seedDoc(admin.id, {
      slug: "doc-newest",
      title: "Newest",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const rows = await queries.listDocs();
    expect(rows).toHaveLength(3);
    expect(rows[0]!.title).toBe("Newest");
    expect(rows[1]!.title).toBe("Middle");
    expect(rows[2]!.title).toBe("Oldest");
  });
});

// ---------------------------------------------------------------------------
// createDoc()
// ---------------------------------------------------------------------------

describe("createDoc()", () => {
  it("inserts a doc and returns a row with all fields populated", async () => {
    const admin = await seedAdmin();

    const row = await queries.createDoc({
      slug: "my-edict",
      title: "My Edict",
      bodyType: "html",
      body: "<p>content</p>",
      createdBy: admin.id,
    });

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.slug).toBe("my-edict");
    expect(row.title).toBe("My Edict");
    expect(row.bodyType).toBe("html");
    expect(row.body).toBe("<p>content</p>");
    expect(row.createdBy).toBe(admin.id);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it("persists a markdown doc correctly", async () => {
    const admin = await seedAdmin();

    const row = await queries.createDoc({
      slug: "markdown-edict",
      title: "Markdown Edict",
      bodyType: "markdown",
      body: "# Hello\n\nworld",
      createdBy: admin.id,
    });

    expect(row.bodyType).toBe("markdown");
    expect(row.body).toBe("# Hello\n\nworld");
  });
});

// ---------------------------------------------------------------------------
// updateDoc()
// ---------------------------------------------------------------------------

describe("updateDoc()", () => {
  it("applies a partial patch — updates only the specified field, bumps updatedAt", async () => {
    const admin = await seedAdmin();
    const original = await seedDoc(admin.id, {
      slug: "patch-target",
      title: "Original Title",
      body: "<p>original body</p>",
      bodyType: "html",
      updatedAt: new Date("2025-01-01T00:00:00Z"),
    });

    const before = new Date();
    const updated = await queries.updateDoc(original.id, { title: "New Title" });
    const after = new Date();

    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(original.id);
    expect(updated!.title).toBe("New Title");
    // Fields not in patch must be unchanged.
    expect(updated!.body).toBe("<p>original body</p>");
    expect(updated!.bodyType).toBe("html");
    expect(updated!.slug).toBe("patch-target");
    // updatedAt must be bumped to approximately now.
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updated!.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("returns null for an unknown id — does not throw", async () => {
    const result = await queries.updateDoc(
      "00000000-0000-0000-0000-000000000000",
      { title: "Ghost" },
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getDocById()
// ---------------------------------------------------------------------------

describe("getDocById()", () => {
  it("returns the row when the id exists", async () => {
    const admin = await seedAdmin();
    const doc = await seedDoc(admin.id, { slug: "find-me", title: "Find Me" });

    const result = await queries.getDocById(doc.id);
    expect(result).toBeDefined();
    expect(result!.id).toBe(doc.id);
    expect(result!.title).toBe("Find Me");
  });

  it("returns undefined when the id does not exist", async () => {
    const result = await queries.getDocById("00000000-0000-0000-0000-000000000000");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listDocsForClient()
// ---------------------------------------------------------------------------

describe("listDocsForClient()", () => {
  it("returns only docs shared with the queried client — not docs shared with other clients", async () => {
    const admin = await seedAdmin();
    const clientA = await seedClient("client-a");
    const clientB = await seedClient("client-b");

    const docA = await seedDoc(admin.id, { slug: "doc-for-a", title: "Doc A" });
    const docB = await seedDoc(admin.id, { slug: "doc-for-b", title: "Doc B" });

    await seedShare(docA.id, clientA.id);
    await seedShare(docB.id, clientB.id);

    const rows = await queries.listDocsForClient(clientA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(docA.id);
    expect(rows[0]!.title).toBe("Doc A");
  });

  it("excludes revoked shares — only active (non-revoked) shares are returned", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("revoke-test");

    const docActive = await seedDoc(admin.id, { slug: "doc-active", title: "Active Doc" });
    const docRevoked = await seedDoc(admin.id, { slug: "doc-revoked", title: "Revoked Doc" });

    await seedShare(docActive.id, client.id);
    await seedShare(docRevoked.id, client.id, {
      revokedAt: new Date("2025-01-01T00:00:00Z"),
    });

    const rows = await queries.listDocsForClient(client.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(docActive.id);
  });

  it("orders results descending by sharedAt (most-recently-shared first)", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("order-shares");

    const docFirst = await seedDoc(admin.id, { slug: "shared-first", title: "First Shared" });
    const docSecond = await seedDoc(admin.id, { slug: "shared-second", title: "Second Shared" });

    // Share oldest first, newest second.
    await seedShare(docFirst.id, client.id, {
      sharedAt: new Date("2025-01-01T00:00:00Z"),
    });
    await seedShare(docSecond.id, client.id, {
      sharedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const rows = await queries.listDocsForClient(client.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.title).toBe("Second Shared");
    expect(rows[1]!.title).toBe("First Shared");
  });

  it("returns [] when no docs are shared with the client", async () => {
    const client = await seedClient("no-shares");
    const rows = await queries.listDocsForClient(client.id);
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getDocForClient()
// ---------------------------------------------------------------------------

describe("getDocForClient()", () => {
  it("returns the full doc (including body) when the client has an active share", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("reader");
    const doc = await seedDoc(admin.id, {
      slug: "full-read",
      title: "Full Read",
      bodyType: "html",
      body: "<p>secret contents</p>",
    });
    await seedShare(doc.id, client.id);

    const result = await queries.getDocForClient(client.id, "full-read");
    expect(result).not.toBeNull();
    expect(result!.id).toBe(doc.id);
    expect(result!.slug).toBe("full-read");
    expect(result!.title).toBe("Full Read");
    expect(result!.bodyType).toBe("html");
    expect(result!.body).toBe("<p>secret contents</p>");
  });

  it("returns null when the slug does not match", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("slug-miss");
    const doc = await seedDoc(admin.id, { slug: "real-slug" });
    await seedShare(doc.id, client.id);

    const result = await queries.getDocForClient(client.id, "wrong-slug");
    expect(result).toBeNull();
  });

  it("returns null when the share is revoked", async () => {
    const admin = await seedAdmin();
    const client = await seedClient("revoked-read");
    const doc = await seedDoc(admin.id, { slug: "revoked-doc" });
    await seedShare(doc.id, client.id, { revokedAt: new Date("2025-01-01T00:00:00Z") });

    const result = await queries.getDocForClient(client.id, "revoked-doc");
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // TENANT ISOLATION — CRITICAL (non-negotiable per spec)
  // A client must NEVER be able to read a doc shared only with another client,
  // even if they know (or guess) the slug.
  // -------------------------------------------------------------------------
  it("TENANT ISOLATION: client B cannot read a doc shared only with client A, even by guessing the slug", async () => {
    const admin = await seedAdmin();
    const clientA = await seedClient("isolation-a");
    const clientB = await seedClient("isolation-b");

    // Share the doc exclusively with client A.
    const doc = await seedDoc(admin.id, { slug: "top-secret-edict" });
    await seedShare(doc.id, clientA.id);

    // Client A can read it.
    const resultA = await queries.getDocForClient(clientA.id, "top-secret-edict");
    expect(resultA).not.toBeNull();
    expect(resultA!.id).toBe(doc.id);

    // Client B gets null — the slug is known but the share doesn't exist for them.
    const resultB = await queries.getDocForClient(clientB.id, "top-secret-edict");
    expect(resultB).toBeNull();
  });
});
