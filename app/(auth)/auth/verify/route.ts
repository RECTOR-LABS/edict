import { type NextRequest, NextResponse } from "next/server";
import { verifyMagicLink } from "@/lib/auth/verify";
import { adminDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE_NAME } from "@/lib/auth/middleware";

const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

/**
 * Two-step verify to defeat email-scanner token pre-fetching (Proton, Outlook
 * ATP, Safe Browsing, corporate gateways). GET renders a landing page with a
 * POST form; the token is only consumed when a human submits the form. GET
 * performs zero DB work, so scanner pre-fetches cannot burn tokens.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return renderInvalid();
  return renderContinue(token);
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const token = form ? String(form.get("token") ?? "") : "";
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

  // Use APP_URL for the redirect origin. req.nextUrl.origin resolves to the
  // app's internal listening socket (e.g. http://localhost:3000) behind a
  // reverse proxy — not the public hostname the user sees. APP_URL is already
  // used by actions/sessions.ts to build the magic-link URL itself; using it
  // here keeps the round-trip origin consistent.
  const baseUrl = process.env.APP_URL ?? req.nextUrl.origin;
  const res = NextResponse.redirect(new URL(redirectTo, baseUrl), 302);
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

function renderContinue(token: string) {
  // Escape token for safe HTML attribute embedding. Tokens from generateToken()
  // are base64url-safe so this is defensive — a malformed ?token= from a
  // scanner probe must not break out of the attribute.
  const safeToken = token.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
  return new NextResponse(
    `<!DOCTYPE html>
     <html lang="en">
       <body style="background:#06060c;color:#e2e8f0;font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0">
         <main style="max-width:480px;padding:24px;text-align:center">
           <h1 style="font-size:22px;margin-bottom:12px;color:#fff">Sign in to Edict</h1>
           <p style="color:#9ca3af;margin-bottom:28px">Confirm you opened this link to continue.</p>
           <form method="post" action="/auth/verify">
             <input type="hidden" name="token" value="${safeToken}" />
             <button type="submit" style="background:#fff;color:#000;border:0;padding:14px 28px;border-radius:3px;font-weight:600;cursor:pointer;font-size:14px">
               Continue signing in →
             </button>
           </form>
           <p style="color:#64748b;font-size:12px;margin-top:32px">This one-time link expires 24 hours after it was sent.</p>
         </main>
       </body>
     </html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
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
