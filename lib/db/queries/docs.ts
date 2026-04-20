import { adminDb, schema } from "@/lib/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export async function listDocs() {
  return adminDb.query.docs.findMany({
    orderBy: (d, { desc }) => [desc(d.updatedAt)],
  });
}

export async function createDoc(input: {
  slug: string;
  title: string;
  bodyType: "html" | "markdown";
  body: string;
  createdBy: string;
}) {
  const [row] = await adminDb.insert(schema.docs).values(input).returning();
  if (!row) throw new Error("doc insert failed");
  return row;
}

export async function updateDoc(
  id: string,
  patch: Partial<{ title: string; body: string; bodyType: "html" | "markdown" }>,
) {
  const [row] = await adminDb
    .update(schema.docs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.docs.id, id))
    .returning();
  return row ?? null;
}

export async function getDocById(id: string) {
  return adminDb.query.docs.findFirst({ where: eq(schema.docs.id, id) });
}

/**
 * Client-facing: docs shared with the given client, non-revoked.
 * Uses admin pool because we've already gated the caller via session;
 * the clientId is trusted.
 */
export async function listDocsForClient(clientId: string) {
  return adminDb
    .select({
      id: schema.docs.id,
      slug: schema.docs.slug,
      title: schema.docs.title,
      bodyType: schema.docs.bodyType,
      sharedAt: schema.docShares.sharedAt,
    })
    .from(schema.docShares)
    .innerJoin(schema.docs, eq(schema.docShares.docId, schema.docs.id))
    .where(and(eq(schema.docShares.clientId, clientId), isNull(schema.docShares.revokedAt)))
    .orderBy(sql`${schema.docShares.sharedAt} DESC`);
}

export async function getDocForClient(clientId: string, docSlug: string) {
  const rows = await adminDb
    .select({
      id: schema.docs.id,
      slug: schema.docs.slug,
      title: schema.docs.title,
      bodyType: schema.docs.bodyType,
      body: schema.docs.body,
    })
    .from(schema.docShares)
    .innerJoin(schema.docs, eq(schema.docShares.docId, schema.docs.id))
    .where(
      and(
        eq(schema.docShares.clientId, clientId),
        eq(schema.docs.slug, docSlug),
        isNull(schema.docShares.revokedAt),
      ),
    );
  return rows[0] ?? null;
}
