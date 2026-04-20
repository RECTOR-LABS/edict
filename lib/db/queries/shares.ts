import { adminDb, schema } from "@/lib/db";
import { and, eq, isNull } from "drizzle-orm";

export async function upsertShare(docId: string, clientId: string) {
  const existing = await adminDb.query.docShares.findFirst({
    where: (s, { and, eq }) => and(eq(s.docId, docId), eq(s.clientId, clientId)),
  });
  if (existing) {
    if (existing.revokedAt) {
      await adminDb
        .update(schema.docShares)
        .set({ revokedAt: null, sharedAt: new Date() })
        .where(eq(schema.docShares.id, existing.id));
    }
    return existing;
  }
  const [row] = await adminDb.insert(schema.docShares).values({ docId, clientId }).returning();
  if (!row) throw new Error("share insert failed");
  return row;
}

export async function revokeShare(docId: string, clientId: string) {
  await adminDb
    .update(schema.docShares)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.docShares.docId, docId),
        eq(schema.docShares.clientId, clientId),
        isNull(schema.docShares.revokedAt),
      ),
    );
}

export async function listSharesForDoc(docId: string) {
  return adminDb.query.docShares.findMany({
    where: (s, { eq }) => eq(s.docId, docId),
    orderBy: (s, { desc }) => [desc(s.sharedAt)],
  });
}
