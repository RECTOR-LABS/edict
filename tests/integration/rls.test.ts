import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let pg: StartedPostgreSqlContainer;
let adminClient: Client;
let appClient: Client;

const MIGRATIONS = ["0000", "0001_session_trigger", "0002_rls"];

beforeAll(async () => {
  pg = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("edict")
    .withUsername("edict_admin")
    .withPassword("test")
    .start();

  // Apply Drizzle migration(s) + handwritten files.
  adminClient = new Client({ connectionString: pg.getConnectionUri() });
  await adminClient.connect();

  const files = await (await import("node:fs/promises"))
    .readdir("./migrations")
    .then(async (names) =>
      Promise.all(
        names
          .filter((n) => n.endsWith(".sql"))
          .sort()
          .map((n) => readFile(join("./migrations", n), "utf8").then((sql) => sql)),
      ),
    );
  for (const sql of files) await adminClient.query(sql);

  // Connect as the RLS-enforced role
  appClient = new Client({
    host: pg.getHost(),
    port: pg.getMappedPort(5432),
    user: "edict_app",
    password: "dev",
    database: "edict",
  });
  await appClient.connect();
}, 60_000);

afterAll(async () => {
  await appClient?.end();
  await adminClient?.end();
  await pg?.stop();
});

describe("RLS — tenant isolation", () => {
  it("blocks cross-tenant SELECT on client_members", async () => {
    // Seed two clients + members via admin role (bypasses RLS)
    const a = await adminClient.query<{ id: string }>(
      `INSERT INTO clients (slug, name) VALUES ('a','A') RETURNING id`,
    );
    const b = await adminClient.query<{ id: string }>(
      `INSERT INTO clients (slug, name) VALUES ('b','B') RETURNING id`,
    );
    await adminClient.query(
      `INSERT INTO client_members (client_id, email, role) VALUES ($1,'x@a.com','viewer')`,
      [a.rows[0]!.id],
    );
    await adminClient.query(
      `INSERT INTO client_members (client_id, email, role) VALUES ($1,'x@b.com','viewer')`,
      [b.rows[0]!.id],
    );

    await appClient.query("BEGIN");
    await appClient.query(`SELECT set_config('edict.client_id', $1, true)`, [a.rows[0]!.id]);
    const visible = await appClient.query(`SELECT email FROM client_members`);
    await appClient.query("COMMIT");

    expect(visible.rowCount).toBe(1);
    expect(visible.rows[0]!.email).toBe("x@a.com");
  });
});
