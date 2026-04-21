import { cache } from "react";
import { eq } from "drizzle-orm";
import { adminDb, schema } from "@/lib/db";

export async function listClients() {
  return adminDb.query.clients.findMany({
    orderBy: (c, { desc }) => [desc(c.createdAt)],
  });
}

export async function createClient(input: {
  slug: string;
  name: string;
  brandColor?: string;
  logoUrl?: string;
}) {
  const [row] = await adminDb
    .insert(schema.clients)
    .values({
      slug: input.slug,
      name: input.name,
      brandColor: input.brandColor ?? null,
      logoUrl: input.logoUrl ?? null,
    })
    .returning();
  if (!row) throw new Error("create client failed");
  return row;
}

export async function getClientById(id: string) {
  return adminDb.query.clients.findFirst({ where: eq(schema.clients.id, id) });
}

/**
 * Request-scoped cache: the client layout + dashboard page both resolve the
 * tenant record by slug on every request. React.cache() dedupes the DB round
 * trip so layout and page share one fetch instead of hitting the pool twice.
 */
export const getClientBySlug = cache(async (slug: string) => {
  return adminDb.query.clients.findFirst({ where: eq(schema.clients.slug, slug) });
});
