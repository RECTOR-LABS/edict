import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";
import type { runAdminInvite } from "@/scripts/admin-invite";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;
let inviteFn: typeof runAdminInvite | undefined;

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
  const inviteModule = await import("@/scripts/admin-invite");
  inviteFn = inviteModule.runAdminInvite;
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
  await adminDb.delete(schema.auditLog);
  await adminDb.delete(schema.magicLinkTokens);
  // sessions has no FK to admins — delete before admins to avoid FK violation on sessions.subjectId
  await adminDb.delete(schema.sessions);
  await adminDb.delete(schema.admins);
});

describe("admin-invite CLI", () => {
  it("brand-new email → creates admin + issues link", async () => {
    expect(inviteFn).toBeDefined();
    const { adminDb, schema } = dbModule!;
    const { eq } = await import("drizzle-orm");

    const result = await inviteFn!("ada@edict.test");

    // Return shape is correct.
    expect(result.email).toBe("ada@edict.test");
    expect(result.created).toBe(true);
    expect(result.delivery).toBe("dev-print");
    expect(result.adminId).toMatch(/^[0-9a-f-]{36}$/);

    // Token URL matches the 52-char base32 raw token (32 bytes → ceil(32*8/5) = 52 chars).
    expect(result.url).toMatch(/^http:\/\/localhost:3000\/auth\/verify\?token=[a-z2-7]{52}$/);

    // admins table has exactly one row with the right email and no name.
    const admins = await adminDb.query.admins.findMany({});
    expect(admins).toHaveLength(1);
    expect(admins[0]!.email).toBe("ada@edict.test");
    expect(admins[0]!.name).toBeNull();
    expect(admins[0]!.id).toBe(result.adminId);

    // magic_link_tokens has one matching row.
    const tokens = await adminDb.query.magicLinkTokens.findMany({
      where: eq(schema.magicLinkTokens.subjectId, result.adminId),
    });
    expect(tokens).toHaveLength(1);
    const tok = tokens[0]!;
    expect(tok.subjectType).toBe("admin");
    expect(tok.email).toBe("ada@edict.test");
    expect(tok.clientId).toBeNull();
    expect(tok.consumedAt).toBeNull();
    expect(tok.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("existing email → reuses admin row + issues new link, does not mutate name", async () => {
    expect(inviteFn).toBeDefined();
    const { adminDb, schema } = dbModule!;
    const { eq } = await import("drizzle-orm");

    // Pre-insert an admin with a name to confirm it is not overwritten.
    await adminDb.insert(schema.admins).values({ email: "returning@edict.test", name: "Prev" });

    const result = await inviteFn!("returning@edict.test");

    // Return shape: not created, dev-print.
    expect(result.created).toBe(false);
    expect(result.delivery).toBe("dev-print");
    expect(result.email).toBe("returning@edict.test");

    // admins still has exactly ONE row — no duplicate.
    const admins = await adminDb.query.admins.findMany({});
    expect(admins).toHaveLength(1);
    expect(admins[0]!.email).toBe("returning@edict.test");

    // Name must not have been touched — we passed { email } with no name field.
    expect(admins[0]!.name).toBe("Prev");

    // A new token was issued.
    const tokens = await adminDb.query.magicLinkTokens.findMany({
      where: eq(schema.magicLinkTokens.subjectId, result.adminId),
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.consumedAt).toBeNull();
    expect(tokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("two invocations → two fresh tokens minted, both unconsumed and unexpired", async () => {
    expect(inviteFn).toBeDefined();
    const { adminDb, schema } = dbModule!;
    const { eq } = await import("drizzle-orm");

    // First invite — creates the admin.
    const first = await inviteFn!("multi@edict.test");
    expect(first.created).toBe(true);

    // Second invite — reuses the admin.
    const second = await inviteFn!("multi@edict.test");
    expect(second.created).toBe(false);
    expect(second.adminId).toBe(first.adminId);

    // Both tokens are distinct.
    expect(first.url).not.toBe(second.url);

    // Two token rows exist, both unconsumed and not expired.
    const tokens = await adminDb.query.magicLinkTokens.findMany({
      where: eq(schema.magicLinkTokens.subjectId, first.adminId),
    });
    expect(tokens).toHaveLength(2);
    for (const tok of tokens) {
      expect(tok.consumedAt).toBeNull();
      expect(tok.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }

    // Only one admin row.
    const admins = await adminDb.query.admins.findMany({});
    expect(admins).toHaveLength(1);
  });

  it("empty or whitespace-only email → throws 'admin email is required', no admin row created", async () => {
    expect(inviteFn).toBeDefined();
    const { adminDb } = dbModule!;

    // Empty string exercises the `!email` short-circuit.
    await expect(inviteFn!("")).rejects.toThrow(/admin email is required/);
    // Whitespace-only variants exercise the `!email.trim()` branch — a refactor
    // that dropped the trim() guard would still pass if we only tested "".
    await expect(inviteFn!("   ")).rejects.toThrow(/admin email is required/);
    await expect(inviteFn!("\t\n")).rejects.toThrow(/admin email is required/);

    // Nothing was written to the DB across all three rejections.
    const admins = await adminDb.query.admins.findMany({});
    expect(admins).toHaveLength(0);
  });

  // Exercises the sendMail glue end-to-end: React.createElement(MagicLinkEmail, {...})
  // → sendMail → @react-email/render → the resend wrapper's dev-skip fallback
  // (because RESEND_API_KEY is absent in tests). A prop typo or runtime template
  // construction error in the sent branch would be caught here.
  it("DEV_PRINT_MAGIC_LINKS=false → sendMail branch runs end-to-end and returns delivery:sent", async () => {
    expect(inviteFn).toBeDefined();
    const { adminDb, schema } = dbModule!;
    const { eq } = await import("drizzle-orm");

    const originalDevPrint = process.env.DEV_PRINT_MAGIC_LINKS;
    const originalResendKey = process.env.RESEND_API_KEY;
    process.env.DEV_PRINT_MAGIC_LINKS = "false";
    delete process.env.RESEND_API_KEY;

    try {
      const result = await inviteFn!("glue@edict.test");

      // The CLI took the sendMail branch, not the dev-print early return.
      expect(result.delivery).toBe("sent");
      expect(result.created).toBe(true);
      expect(result.email).toBe("glue@edict.test");
      expect(result.adminId).toMatch(/^[0-9a-f-]{36}$/);

      // DB writes are identical to the dev-print happy path.
      const admins = await adminDb.query.admins.findMany({});
      expect(admins).toHaveLength(1);
      expect(admins[0]!.email).toBe("glue@edict.test");

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
