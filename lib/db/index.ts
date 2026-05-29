import { drizzle as drizzleNeon, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import ws from "ws";
import * as schema from "@/lib/db/schema";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

// Neon's serverless driver speaks Postgres over WebSocket — required on Vercel
// Functions, where a plain-TCP pg.Pool dies with "Connection closed.". That
// WebSocket protocol cannot reach a vanilla Postgres though (local docker, CI
// testcontainers), so fall back to node-postgres for non-Neon targets. Detect
// by host: Neon endpoints live under *.neon.tech.
function isNeonHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

const databaseUrl = required("DATABASE_URL");
const adminUrl = required("DATABASE_ADMIN_URL");
const useNeon = isNeonHost(databaseUrl);

const poolOpts = { connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 };

// Minimal structural view of a pool/client — the two drivers expose the same
// surface for the bits we use. Driver-bridging casts are confined to this file.
interface PoolLike {
  connect(): Promise<ClientLike>;
  on(event: "error", listener: (err: Error) => void): unknown;
  end(): Promise<void>;
}
interface ClientLike {
  query(text: string, params?: unknown[]): Promise<unknown>;
  release(): void;
}

/**
 * Both drizzle drivers expose the same pg-core query API for our schema; we
 * type the exports as NeonDatabase (the production driver) and cast the
 * node-postgres build to it. Casts stay inside this adapter module.
 *
 * `$client` is added by drizzle()'s return type (not by NeonDatabase itself);
 * re-add the slice we use (pool teardown in tests) to the alias.
 */
type Db = NeonDatabase<typeof schema> & { $client: { end(): Promise<void> } };

let appPool: PoolLike;
let adminPool: PoolLike;
let db: Db;
let adminDb: Db;

if (useNeon) {
  // Node (Vercel Functions) has no global WebSocket; supply one.
  neonConfig.webSocketConstructor = ws;
  const ap = new NeonPool({ connectionString: databaseUrl, max: 10, ...poolOpts });
  const adp = new NeonPool({ connectionString: adminUrl, max: 5, ...poolOpts });
  db = drizzleNeon(ap, { schema });
  adminDb = drizzleNeon(adp, { schema });
  appPool = ap as unknown as PoolLike;
  adminPool = adp as unknown as PoolLike;
} else {
  const ap = new PgPool({ connectionString: databaseUrl, max: 10, ...poolOpts });
  const adp = new PgPool({ connectionString: adminUrl, max: 5, ...poolOpts });
  db = drizzlePg(ap, { schema }) as unknown as Db;
  adminDb = drizzlePg(adp, { schema }) as unknown as Db;
  appPool = ap as unknown as PoolLike;
  adminPool = adp as unknown as PoolLike;
}

// pg crashes the process on unhandled idle-client errors (e.g. ECONNRESET); the
// Neon pool surfaces socket errors the same way. Log and let the pool discard.
appPool.on("error", (err: Error) => {
  console.error("edict appPool idle client error", err);
});
adminPool.on("error", (err: Error) => {
  console.error("edict adminPool idle client error", err);
});

/** RLS-enforced connection (role `edict_app`) — use for all per-request client work via `withClientScope`. */
export { db };
/** BYPASSRLS connection — admin-only operations (token issue, session ops, audit writes, cross-tenant lookups). Never use in client-scoped code paths. */
export { adminDb };

/**
 * Run `fn` inside a transaction where edict.client_id is set for the duration.
 * Use for all per-request client-scoped work.
 */
export async function withClientScope<T>(
  clientId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('edict.client_id', $1, true)", [clientId]);
    const tx = (
      useNeon
        ? drizzleNeon(client as never, { schema })
        : drizzlePg(client as never, { schema })
    ) as unknown as Db;
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export { schema };
