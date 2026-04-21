import { and, eq, isNull } from "drizzle-orm";
import { adminDb, schema } from "@/lib/db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as dbSchema from "@/lib/db/schema";

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

/**
 * Revoke all non-revoked sessions for a given subject (spec §5.4).
 *
 * Accepts an optional Drizzle transaction client so callers can compose this
 * into a larger atomic operation (e.g. revokeMember). When `tx` is omitted the
 * function uses the global `adminDb` pool directly.
 *
 * @returns The number of sessions that were revoked.
 */
export async function revokeSessionsForSubject(
  subjectType: "admin" | "client_member",
  subjectId: string,
  tx?: NodePgDatabase<typeof dbSchema>,
): Promise<{ revokedCount: number }> {
  const db = tx ?? adminDb;
  const result = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.sessions.subjectType, subjectType),
        eq(schema.sessions.subjectId, subjectId),
        isNull(schema.sessions.revokedAt),
      ),
    )
    .returning({ id: schema.sessions.id });
  return { revokedCount: result.length };
}
