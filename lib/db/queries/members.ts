import { and, eq, isNull } from "drizzle-orm";
import { adminDb, schema } from "@/lib/db";

export async function listMembersForClient(clientId: string) {
  return adminDb.query.clientMembers.findMany({
    where: (m, { and, eq, isNull }) => and(eq(m.clientId, clientId), isNull(m.revokedAt)),
    orderBy: (m, { desc }) => [desc(m.createdAt)],
  });
}

export async function upsertMember(input: {
  clientId: string;
  email: string;
  name?: string | null;
  role: "viewer" | "admin_of_client";
}) {
  const existing = await adminDb.query.clientMembers.findFirst({
    where: (m, { and, eq }) => and(eq(m.clientId, input.clientId), eq(m.email, input.email)),
  });
  if (existing) {
    if (existing.revokedAt) {
      await adminDb
        .update(schema.clientMembers)
        .set({ revokedAt: null })
        .where(eq(schema.clientMembers.id, existing.id));
    }
    return existing;
  }
  const [row] = await adminDb
    .insert(schema.clientMembers)
    .values({
      clientId: input.clientId,
      email: input.email,
      name: input.name ?? null,
      role: input.role,
    })
    .returning();
  if (!row) throw new Error("member insert failed");
  return row;
}

export async function revokeMember(memberId: string) {
  await adminDb
    .update(schema.clientMembers)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.clientMembers.id, memberId), isNull(schema.clientMembers.revokedAt)));
}
