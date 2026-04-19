import { generateToken } from "@/lib/auth/tokens";
import { insertMagicLinkToken } from "@/lib/db/queries/tokens";
import { writeAudit } from "@/lib/db/queries/audit";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function issueMagicLink(input: {
  subjectType: "client_member" | "admin";
  subjectId: string;
  email: string;
  clientId: string | null;
  actorId?: string | null;
  docId?: string | null;
}): Promise<{ raw: string; expiresIn: number }> {
  const { raw, hash } = generateToken();
  await insertMagicLinkToken({
    tokenHash: hash,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    email: input.email,
    clientId: input.clientId,
    ttlMs: TWENTY_FOUR_HOURS_MS,
  });
  await writeAudit({
    eventType: "magic_link_sent",
    actorType: input.actorId ? "admin" : "system",
    actorId: input.actorId ?? null,
    clientId: input.clientId,
    docId: input.docId ?? null,
    metadata: { recipient_email: input.email, ttl_hours: 24 },
  });
  return { raw, expiresIn: TWENTY_FOUR_HOURS_MS };
}
