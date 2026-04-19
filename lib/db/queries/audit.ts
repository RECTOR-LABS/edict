import { adminDb, schema } from "@/lib/db";

type ActorType = "client_member" | "admin" | "system";

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
