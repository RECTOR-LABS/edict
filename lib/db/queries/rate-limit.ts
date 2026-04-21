import { and, eq, gt, sql } from "drizzle-orm";
import { adminDb, schema } from "@/lib/db";

/**
 * Sliding-window rate limiter backed by `rate_limit_events`.
 *
 * Returns true if `bucketKey` has been hit < `limit` times in the last
 * `windowMs` milliseconds. Always records the current attempt (which counts
 * toward future windows).
 *
 * Intended call sites:
 *   - `verify:email:<email>` — landing-page magic-link sends (~10/hour/email)
 *   - `share:admin:<adminId>` — admin share emails (~30/hour/admin)
 *
 * Callers decide how to react on `false`:
 *   - landing page: silent success (enumeration defense)
 *   - admin share: throw with actionable error
 *
 * The `rate_limit_events` table is pruned by a separate cron (~14d retention).
 */
export async function rateLimitAllow(
  bucketKey: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const [row] = await adminDb
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.rateLimitEvents)
    .where(
      and(
        eq(schema.rateLimitEvents.bucketKey, bucketKey),
        gt(schema.rateLimitEvents.createdAt, since),
      ),
    );
  const recent = row?.n ?? 0;
  await adminDb.insert(schema.rateLimitEvents).values({ bucketKey });
  return recent < limit;
}
