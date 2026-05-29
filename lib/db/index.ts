import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig, type PoolClient } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "@/lib/db/schema";

// Node.js (Vercel Functions, local dev) needs an explicit WebSocket implementation.
// The browser already has WebSocket; this is a no-op there but harmless to set.
neonConfig.webSocketConstructor = ws;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

const appPool = new Pool({
  connectionString: required("DATABASE_URL"),
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});
const adminPool = new Pool({
  connectionString: required("DATABASE_ADMIN_URL"),
  max: 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

// Neon driver also surfaces socket errors; log and let the pool discard.
appPool.on("error", (err: Error) => {
  console.error("edict appPool idle client error", err);
});
adminPool.on("error", (err: Error) => {
  console.error("edict adminPool idle client error", err);
});

/** RLS-enforced connection (role `edict_app`) — use for all per-request client work via `withClientScope`. */
export const db = drizzle(appPool, { schema });
/** BYPASSRLS connection — admin-only operations (token issue, session ops, audit writes, cross-tenant lookups). Never use in client-scoped code paths. */
export const adminDb = drizzle(adminPool, { schema });

/**
 * Run `fn` inside a transaction where edict.client_id is set for the duration.
 * Use for all per-request client-scoped work.
 */
export async function withClientScope<T>(
  clientId: string,
  fn: (tx: NeonDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await appPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('edict.client_id', $1, true)", [clientId]);
    const tx = drizzle(client, { schema });
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
