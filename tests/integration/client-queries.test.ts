import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type {
  listClients,
  createClient,
  getClientById,
  getClientBySlug,
} from "@/lib/db/queries/clients";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let queries: {
  listClients: typeof listClients;
  createClient: typeof createClient;
  getClientById: typeof getClientById;
  getClientBySlug: typeof getClientBySlug;
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
  queries = await import("@/lib/db/queries/clients");
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

// Truncate clients before each test — cascade clears child tables too.
beforeEach(async () => {
  if (!dbModule) return;
  await dbModule.adminDb.delete(dbModule.schema.clients);
});

describe("listClients()", () => {
  it("returns [] on empty table", async () => {
    const rows = await queries.listClients();
    expect(rows).toEqual([]);
  });

  it("orders results descending by createdAt (most-recent first)", async () => {
    // Insert with explicit timestamps to guarantee deterministic order.
    const { adminDb, schema } = dbModule!;
    await adminDb.insert(schema.clients).values([
      {
        slug: "oldest",
        name: "Oldest",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
      {
        slug: "middle",
        name: "Middle",
        createdAt: new Date("2025-06-01T00:00:00Z"),
      },
      {
        slug: "newest",
        name: "Newest",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const rows = await queries.listClients();
    expect(rows).toHaveLength(3);
    expect(rows[0]!.slug).toBe("newest");
    expect(rows[1]!.slug).toBe("middle");
    expect(rows[2]!.slug).toBe("oldest");
  });
});

describe("createClient()", () => {
  it("happy path — returns inserted row with all provided fields", async () => {
    const row = await queries.createClient({
      slug: "acme",
      name: "Acme Corp",
      brandColor: "#ff6600",
      logoUrl: "https://acme.example/logo.png",
    });

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.slug).toBe("acme");
    expect(row.name).toBe("Acme Corp");
    expect(row.brandColor).toBe("#ff6600");
    expect(row.logoUrl).toBe("https://acme.example/logo.png");
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("stores null for omitted optional fields — not undefined, not empty string", async () => {
    const row = await queries.createClient({ slug: "bare", name: "Bare Client" });

    expect(row.brandColor).toBeNull();
    expect(row.logoUrl).toBeNull();
  });

  it("throws a Postgres unique-constraint error on duplicate slug", async () => {
    await queries.createClient({ slug: "dup", name: "First" });
    await expect(queries.createClient({ slug: "dup", name: "Second" })).rejects.toThrow();
  });
});

describe("getClientById()", () => {
  it("returns the matching row when the id exists", async () => {
    const created = await queries.createClient({ slug: "by-id", name: "By ID" });
    const found = await queries.getClientById(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.slug).toBe("by-id");
  });

  it("returns undefined when the id does not exist", async () => {
    const result = await queries.getClientById("00000000-0000-0000-0000-000000000000");
    expect(result).toBeUndefined();
  });
});

describe("getClientBySlug()", () => {
  it("returns the matching row when the slug exists", async () => {
    const created = await queries.createClient({ slug: "by-slug", name: "By Slug" });
    const found = await queries.getClientBySlug("by-slug");
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe("By Slug");
  });

  it("returns undefined when the slug does not exist", async () => {
    const result = await queries.getClientBySlug("nonexistent-slug");
    expect(result).toBeUndefined();
  });
});
