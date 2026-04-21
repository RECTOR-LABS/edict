import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import type * as DbModule from "@/lib/db";

let pg: StartedPostgreSqlContainer;
let dbModule: typeof DbModule | undefined;

beforeAll(async () => {
  pg = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("edict")
    .withUsername("edict_admin")
    .withPassword("test")
    .start();

  // Apply migrations via the superuser connection (it has BYPASSRLS and create-role rights)
  const bootstrap = new Pool({ connectionString: pg.getConnectionUri() });
  const names = (await readdir("./migrations")).filter((n) => n.endsWith(".sql")).sort();
  for (const n of names) await bootstrap.query(await readFile(join("./migrations", n), "utf8"));
  await bootstrap.end();

  // Build env vars explicitly from host/port — do NOT string-replace (different passwords)
  const host = pg.getHost();
  const port = pg.getMappedPort(5432);
  process.env.DATABASE_URL = `postgres://edict_app:dev@${host}:${port}/edict`;
  process.env.DATABASE_ADMIN_URL = pg.getConnectionUri();
}, 60_000);

afterAll(async () => {
  // Drain drizzle pools before the container dies, otherwise Postgres
  // terminates open connections and vitest surfaces an unhandled error.
  if (dbModule) {
    await dbModule.db.$client.end().catch(() => {});
    await dbModule.adminDb.$client.end().catch(() => {});
  }
  await pg?.stop();
});

describe("magic link: issue → verify", () => {
  it("issues, verifies, creates session, and refuses replay", async () => {
    // Dynamic import AFTER env vars are set — top-level import would fail required() check
    dbModule = await import("@/lib/db");
    const { adminDb, schema } = dbModule;
    const { eq } = await import("drizzle-orm");
    const { sha256Hex } = await import("@/lib/utils/hash");
    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "a@edict.test", name: "Admin A" })
      .returning();

    const { issueMagicLink } = await import("@/lib/auth/issue");
    const { verifyMagicLink } = await import("@/lib/auth/verify");

    const { raw } = await issueMagicLink({
      subjectType: "admin",
      subjectId: admin!.id,
      email: "a@edict.test",
      clientId: null,
    });

    const first = await verifyMagicLink({ rawToken: raw });
    if (!first.ok) throw new Error(`expected verify to succeed, got reason=${first.reason}`);
    // 64 random bytes base32-no-pad → ceil(64 * 8 / 5) = 103 chars, lowercase alphanumeric.
    expect(first.sessionToken).toMatch(/^[a-z0-9]{103}$/);
    expect(first.subjectType).toBe("admin");
    expect(first.clientId).toBeNull();

    // Persisted session matches the returned token and is scoped to the issuing admin.
    const sessionRow = await adminDb.query.sessions.findFirst({
      where: eq(schema.sessions.sessionTokenHash, sha256Hex(first.sessionToken)),
    });
    expect(sessionRow).toBeTruthy();
    expect(sessionRow?.subjectType).toBe("admin");
    expect(sessionRow?.subjectId).toBe(admin!.id);
    expect(sessionRow?.clientId).toBeNull();
    expect(sessionRow?.revokedAt).toBeNull();

    const replay = await verifyMagicLink({ rawToken: raw });
    expect(replay.ok).toBe(false);
  });
});
