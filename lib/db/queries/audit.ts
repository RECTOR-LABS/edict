import { adminDb, schema } from "@/lib/db";

type ActorType = "client_member" | "admin" | "system";

/**
 * Writes an audit log row. Always goes through `adminDb` (BYPASSRLS):
 * `magic_link_failed` events carry no client_id, and `admin` actor events
 * likewise have null client_id — both would be rejected by the
 * `audit_log_tenant_isolation` RLS policy if routed through the app pool.
 * Do not migrate this to `db` without widening the RLS insert policy first.
 */
export async function writeAudit(input: {
  eventType: string;
  actorType: ActorType;
  actorId?: string | null;
  clientId?: string | null;
  docId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await adminDb.insert(schema.auditLog).values({
    eventType: input.eventType,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    clientId: input.clientId ?? null,
    docId: input.docId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata ?? {},
  });
}
