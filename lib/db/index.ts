import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "@/lib/db/schema";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

const appPool = new Pool({
  connectionString: required("DATABASE_URL"),
  max: 10,
});
const adminPool = new Pool({
  connectionString: required("DATABASE_ADMIN_URL"),
  max: 5,
});

export const db = drizzle(appPool, { schema });
export const adminDb = drizzle(adminPool, { schema });

/**
 * Run `fn` inside a transaction where edict.client_id is set for the duration.
 * Use for all per-request client-scoped work.
 */
export async function withClientScope<T>(
  clientId: string,
  fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
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
