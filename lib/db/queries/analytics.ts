import { adminDb, schema } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";

/**
 * Aggregate view counts for a single doc.
 *
 * - totals: global views + unique-viewer count filtered to doc_viewed events.
 * - byMember: per-actor breakdown with resolved email (left-join to clientMembers),
 *   view count, and most-recent view timestamp — ordered by views desc.
 */
export async function docAnalytics(docId: string) {
  const [totals] = await adminDb
    .select({
      views: sql<number>`count(*) filter (where ${schema.auditLog.eventType} = 'doc_viewed')::int`,
      uniqueViewers: sql<number>`count(distinct ${schema.auditLog.actorId}) filter (where ${schema.auditLog.eventType} = 'doc_viewed')::int`,
    })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.docId, docId));

  const byMember = await adminDb
    .select({
      actorId: schema.auditLog.actorId,
      // Resolve email from clientMembers when the actor is a known member.
      // actorId is nullable in schema; coalesce with null for non-member actors.
      memberEmail: schema.clientMembers.email,
      views: sql<number>`count(*)::int`,
      lastViewedAt: sql<Date>`max(${schema.auditLog.createdAt})`,
    })
    .from(schema.auditLog)
    .leftJoin(
      schema.clientMembers,
      eq(schema.auditLog.actorId, schema.clientMembers.id),
    )
    .where(
      and(
        eq(schema.auditLog.docId, docId),
        eq(schema.auditLog.eventType, "doc_viewed"),
      ),
    )
    .groupBy(schema.auditLog.actorId, schema.clientMembers.email)
    .orderBy(sql`count(*) desc`);

  return {
    totals: totals ?? { views: 0, uniqueViewers: 0 },
    byMember,
  };
}

/**
 * Recent audit log entries, newest first.
 *
 * Plan extension (permitted): optional `eventType` filter wires up the
 * dashboard's "Views 7d" card link (`/admin/audit?event=doc_viewed`) so the
 * audit page can pre-filter without a separate query function.
 */
export async function recentAuditLog(limit = 50, eventType?: string) {
  return adminDb.query.auditLog.findMany({
    where: eventType ? (a, { eq }) => eq(a.eventType, eventType) : undefined,
    orderBy: (a, { desc }) => [desc(a.createdAt)],
    limit,
  });
}
