import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sha256Hex } from "@/lib/utils/hash";
import { findActiveSessionByTokenHash } from "@/lib/db/queries/sessions";
import { writeAudit } from "@/lib/db/queries/audit";
import { SESSION_COOKIE_NAME } from "@/lib/auth/middleware";

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return NextResponse.json({ ok: false }, { status: 401 });

  const session = await findActiveSessionByTokenHash(sha256Hex(raw));
  if (!session || session.subjectType !== "client_member" || !session.clientId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await req
    .json()
    .catch((err: unknown) => {
      console.warn("[track-view] malformed body:", err);
      return null;
    })) as { docId?: string; duration_ms?: number; opened?: boolean } | null;

  if (!body?.docId) return NextResponse.json({ ok: false }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;

  await writeAudit({
    eventType: "doc_viewed",
    actorType: "client_member",
    actorId: session.subjectId,
    clientId: session.clientId,
    docId: body.docId,
    ip,
    userAgent: ua,
    metadata: body.opened
      ? { phase: "open" }
      : { phase: "close", duration_ms: body.duration_ms ?? null },
  });

  return NextResponse.json({ ok: true });
}
