import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type { runAdminSeed } from "@/scripts/admin-seed";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let seedFn: typeof runAdminSeed | undefined;

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
  // Force dev-print path — no Resend call in tests.
  process.env.DEV_PRINT_MAGIC_LINKS = "true";

  // Dynamic imports AFTER env is set.
  dbModule = await import("@/lib/db");
  const seedModule = await import("@/scripts/admin-seed");
  seedFn = seedModule.runAdminSeed;
}, 60_000);

afterAll(async () => {
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

// Reset tables before each test to give full isolation without spawning extra containers.
beforeEach(async () => {
  if (!dbModule) return;
  const { adminDb, schema } = dbModule;
  // Reset order is arbitrary — sessions.subjectId, magic_link_tokens.subjectId,
  // and audit_log.actorId are plain uuid columns with NO FK to admins. These
  // four tables can be truncated in any order without FK violations.
  await adminDb.delete(schema.auditLog);
  await adminDb.delete(schema.magicLinkTokens);
  await adminDb.delete(schema.sessions);
  await adminDb.delete(schema.admins);
});

describe("admin-seed CLI", () => {
  it("empty admins table → seed succeeds and returns correct shape", async () => {
    expect(seedFn).toBeDefined();
    const { adminDb, schema } = dbModule!;
    const { eq } = await import("drizzle-orm");

    const result = await seedFn!("rector@edict.test");

    // Return shape is correct.
    expect(result.email).toBe("rector@edict.test");
    expect(result.delivery).toBe("dev-print");
    expect(result.adminId).toMatch(/^[0-9a-f-]{36}$/);

    // Token URL matches the 52-char base32 raw token (32 bytes → ceil(32*8/5) = 52 chars).
    expect(result.url).toMatch(/^http:\/\/localhost:3000\/auth\/verify\?token=[a-z2-7]{52}$/);

    // admins table has exactly one row with the right email and name.
    const admins = await adminDb.query.admins.findMany({});
    expect(admins).toHaveLength(1);
    expect(admins[0]!.email).toBe("rector@edict.test");
    expect(admins[0]!.name).toBe("Bootstrap Admin");
    expect(admins[0]!.id).toBe(result.adminId);

    // magic_link_tokens has one matching row.
    const tokens = await adminDb.query.magicLinkTokens.findMany({
      where: eq(schema.magicLinkTokens.subjectId, result.adminId),
    });
    expect(tokens).toHaveLength(1);
    const tok = tokens[0]!;
    expect(tok.subjectType).toBe("admin");
    expect(tok.email).toBe("rector@edict.test");
    expect(tok.clientId).toBeNull();
    expect(tok.consumedAt).toBeNull();
    expect(tok.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("non-empty admins table → seed throws without inserting a new admin or token", async () => {
    expect(seedFn).toBeDefined();
    const { adminDb, schema } = dbModule!;

    // Pre-insert an admin to trip the gate.
    await adminDb
      .insert(schema.admins)
      .values({ email: "existing@edict.test", name: "Existing" });

    await expect(seedFn!("new@edict.test")).rejects.toThrow(/admins table is not empty/);

    // admins table still has only the pre-existing row.
    const admins = await adminDb.query.admins.findMany({});
    expect(admins).toHaveLength(1);
    expect(admins[0]!.email).toBe("existing@edict.test");

    // No token was issued.
    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(0);
  });

  it("missing APP_URL → URL falls back to http://localhost:3000", async () => {
    expect(seedFn).toBeDefined();

    // Ensure APP_URL is absent for this test.
    const original = process.env.APP_URL;
    delete process.env.APP_URL;

    try {
      const result = await seedFn!("fresh@edict.test");
      expect(result.url.startsWith("http://localhost:3000/auth/verify?token=")).toBe(true);
      expect(result.delivery).toBe("dev-print");
    } finally {
      // Restore env so other tests are unaffected.
      if (original !== undefined) process.env.APP_URL = original;
    }
  });

  // Exercises the sendMail glue end-to-end: React.createElement(MagicLinkEmail, {...})
  // → sendMail → @react-email/render → the resend wrapper's dev-skip fallback
  // (because RESEND_API_KEY is absent in tests). A prop typo or runtime template
  // construction error in the sent branch would be caught here.
  it("DEV_PRINT_MAGIC_LINKS=false → sendMail branch runs end-to-end and returns delivery:sent", async () => {
    expect(seedFn).toBeDefined();
    const { adminDb, schema } = dbModule!;
    const { eq } = await import("drizzle-orm");

    const originalDevPrint = process.env.DEV_PRINT_MAGIC_LINKS;
    const originalResendKey = process.env.RESEND_API_KEY;
    process.env.DEV_PRINT_MAGIC_LINKS = "false";
    delete process.env.RESEND_API_KEY;

    try {
      const result = await seedFn!("glue@edict.test");

      // The CLI took the sendMail branch, not the dev-print early return.
      expect(result.delivery).toBe("sent");
      expect(result.email).toBe("glue@edict.test");
      expect(result.adminId).toMatch(/^[0-9a-f-]{36}$/);

      // DB writes are identical to the dev-print happy path.
      const admins = await adminDb.query.admins.findMany({});
      expect(admins).toHaveLength(1);
      expect(admins[0]!.email).toBe("glue@edict.test");
      expect(admins[0]!.name).toBe("Bootstrap Admin");

      const tokens = await adminDb.query.magicLinkTokens.findMany({
        where: eq(schema.magicLinkTokens.subjectId, result.adminId),
      });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.consumedAt).toBeNull();
      expect(tokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    } finally {
      if (originalDevPrint !== undefined) {
        process.env.DEV_PRINT_MAGIC_LINKS = originalDevPrint;
      } else {
        delete process.env.DEV_PRINT_MAGIC_LINKS;
      }
      if (originalResendKey !== undefined) process.env.RESEND_API_KEY = originalResendKey;
    }
  });
});
