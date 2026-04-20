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

export async function getClientBySlug(slug: string) {
  return adminDb.query.clients.findFirst({ where: eq(schema.clients.slug, slug) });
}
