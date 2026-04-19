import { and, eq, gt, isNull } from "drizzle-orm";
import { adminDb, schema } from "@/lib/db";

type Subject = "client_member" | "admin";

export async function insertMagicLinkToken(input: {
  tokenHash: string;
  subjectType: Subject;
  subjectId: string;
  email: string;
  clientId: string | null;
  ttlMs: number;
}) {
  const expiresAt = new Date(Date.now() + input.ttlMs);
  const [row] = await adminDb
    .insert(schema.magicLinkTokens)
    .values({
      tokenHash: input.tokenHash,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      email: input.email,
      clientId: input.clientId,
      expiresAt,
    })
    .returning({ id: schema.magicLinkTokens.id });
  if (!row) throw new Error("token insert failed");
  return row;
}

export async function consumeMagicLinkToken(tokenHash: string) {
  const now = new Date();
  const [row] = await adminDb
    .update(schema.magicLinkTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(schema.magicLinkTokens.tokenHash, tokenHash),
        isNull(schema.magicLinkTokens.consumedAt),
        gt(schema.magicLinkTokens.expiresAt, now),
      ),
    )
    .returning();
  return row ?? null;
}
