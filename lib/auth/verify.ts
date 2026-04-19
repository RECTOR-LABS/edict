import { sha256Hex } from "@/lib/utils/hash";
import { generateToken } from "@/lib/auth/tokens";
import { consumeMagicLinkToken } from "@/lib/db/queries/tokens";
import { insertSession } from "@/lib/db/queries/sessions";
import { writeAudit } from "@/lib/db/queries/audit";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `reason` is forward-compat. Every failure path currently collapses to
 * `"invalid"` to avoid an enumeration oracle — distinguishing "no such token"
 * from "expired" from "already consumed" would let an attacker confirm valid
 * hashes. Callers should render a generic failure UI regardless of reason.
 */
export type VerifyResult =
  | {
      ok: true;
      sessionToken: string;
      subjectType: "client_member" | "admin";
      clientId: string | null;
    }
  | { ok: false; reason: "invalid" | "expired" | "consumed" };

export async function verifyMagicLink(input: {
  rawToken: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<VerifyResult> {
  const tokenHash = sha256Hex(input.rawToken);
  const consumed = await consumeMagicLinkToken(tokenHash);
  if (!consumed) {
    await writeAudit({
      eventType: "magic_link_failed",
      actorType: "system",
      metadata: { token_hash_prefix: tokenHash.slice(0, 8), reason: "miss_or_expired" },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
    return { ok: false, reason: "invalid" };
  }

  if (consumed.subjectType !== "client_member" && consumed.subjectType !== "admin") {
    return { ok: false, reason: "invalid" };
  }

  const session = generateToken(64);
  const created = await insertSession({
    sessionTokenHash: session.hash,
    subjectType: consumed.subjectType,
    subjectId: consumed.subjectId,
    clientId: consumed.clientId ?? null,
    ttlMs: THIRTY_DAYS_MS,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  await writeAudit({
    eventType: "session_created",
    actorType: consumed.subjectType,
    actorId: consumed.subjectId,
    clientId: consumed.clientId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    metadata: { session_id: created.id },
  });

  return {
    ok: true,
    sessionToken: session.raw,
    subjectType: consumed.subjectType,
    clientId: consumed.clientId ?? null,
  };
}
