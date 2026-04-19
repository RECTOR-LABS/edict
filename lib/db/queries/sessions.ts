import { and, eq, isNull } from "drizzle-orm";
import { adminDb, schema } from "@/lib/db";

type Subject = "client_member" | "admin";

export async function insertSession(input: {
  sessionTokenHash: string;
  subjectType: Subject;
  subjectId: string;
  clientId: string | null;
  ttlMs: number;
  ip: string | null;
  userAgent: string | null;
}) {
  const expiresAt = new Date(Date.now() + input.ttlMs);
  const [row] = await adminDb
    .insert(schema.sessions)
    .values({
      sessionTokenHash: input.sessionTokenHash,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      clientId: input.clientId,
      expiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    })
    .returning();
  if (!row) throw new Error("session insert failed");
  return row;
}

export async function findActiveSessionByTokenHash(sessionTokenHash: string) {
  const now = new Date();
  const row = await adminDb.query.sessions.findFirst({
    where: (s, { and, eq, isNull, gt }) =>
      and(eq(s.sessionTokenHash, sessionTokenHash), isNull(s.revokedAt), gt(s.expiresAt, now)),
  });
  return row ?? null;
}

export async function revokeSession(sessionId: string) {
  await adminDb
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)));
}

export async function touchSession(sessionId: string) {
  await adminDb
    .update(schema.sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.sessions.id, sessionId));
}
