import { type NextRequest, NextResponse } from "next/server";
import { verifyMagicLink } from "@/lib/auth/verify";
import { adminDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE_NAME } from "@/lib/auth/middleware";

const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return renderInvalid();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;

  let result;
  try {
    result = await verifyMagicLink({ rawToken: token, ip, userAgent: ua });
  } catch (err) {
    console.error("[auth/verify] verifyMagicLink threw:", err);
    return renderInvalid();
  }
  if (!result.ok) return renderInvalid();

  let redirectTo = "/";
  if (result.subjectType === "admin") redirectTo = "/admin";
  else if (result.clientId) {
    const client = await adminDb.query.clients.findFirst({
      where: eq(schema.clients.id, result.clientId),
      columns: { slug: true },
    });
    // Defensive: unreachable under the current schema. sessions.client_id FK
    // (ON DELETE no action) prevents a client row from being removed while a
    // session references it — verifyMagicLink.insertSession would throw a FK
    // violation first, caught by the try/catch above. Kept for Phase I schema
    // evolution (e.g., if we relax the FK to ON DELETE cascade).
    if (!client) return renderInvalid();
    redirectTo = `/c/${client.slug}`;
  }

  const res = NextResponse.redirect(new URL(redirectTo, req.nextUrl.origin), 302);
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: result.sessionToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
  });
  return res;
}

function renderInvalid() {
  return new NextResponse(
    `<!DOCTYPE html>
     <html lang="en">
       <body style="background:#06060c;color:#e2e8f0;font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0">
         <main style="max-width:480px;padding:24px;text-align:center">
           <h1 style="font-size:20px;margin-bottom:8px">This link is no longer valid</h1>
           <p style="color:#64748b">Request a new link from the sign-in page.</p>
           <p style="margin-top:32px"><a href="/" style="color:#00e5ff">← Back to sign-in</a></p>
         </main>
       </body>
     </html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
