import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sha256Hex } from "@/lib/utils/hash";
import { findActiveSessionByTokenHash, revokeSession } from "@/lib/db/queries/sessions";
import { writeAudit } from "@/lib/db/queries/audit";
import { SESSION_COOKIE_NAME } from "@/lib/auth/middleware";

// The sessions table enforces subjectType IN ('admin','client_member') via DB
// CHECK constraint, but Drizzle infers the column as `string`. Cast to the
// narrower union that writeAudit expects — safe given the DB-level guarantee.
type ActorType = "admin" | "client_member";

export async function POST(_req: NextRequest): Promise<Response> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE_NAME)?.value;
  if (raw) {
    const s = await findActiveSessionByTokenHash(sha256Hex(raw));
    if (s) {
      await revokeSession(s.id);
      await writeAudit({
        eventType: "session_revoked",
        actorType: s.subjectType as ActorType,
        actorId: s.subjectId,
        clientId: s.clientId ?? null,
        metadata: { session_id: s.id, reason: "logout" },
      });
    }
  }
  const res = NextResponse.redirect(new URL("/", process.env.APP_URL ?? "http://localhost:3000"), 302);
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}
