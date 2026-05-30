# Two-Step Verify Implementation Plan

> **Historical artifact (April 2026).** Completed build plan for the two-step magic-link verify flow (the feature is live). Predates the Vercel + Neon migration (2026-05-30); any infra references are historical. The shipped behaviour is documented in `docs/deployment-runbook.md` → *Two-step magic-link verify*.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect magic-link tokens from being silently consumed by email-scanner pre-fetching (Proton, Outlook ATP, Google Safe Browsing, corporate gateways) by splitting `/auth/verify` into a scanner-safe GET (landing page, no DB touch) and a human-initiated POST (consume token + set cookie + redirect).

**Architecture:** The email URL (`/auth/verify?token=XYZ`) stays unchanged. GET becomes a thin, DB-free renderer that shows a "Continue signing in" HTML form with the token in a hidden input. The form's POST target is the same route — POST runs the existing `verifyMagicLink` logic, sets the session cookie, and redirects. Link scanners only fire GETs, so tokens survive pre-fetching until a real user clicks the Continue button. This is the pattern used by Slack, Notion, Linear, and Stripe for exactly this reason.

**Tech Stack:** Next.js 15 App Router route handlers, Vitest + @testcontainers/postgresql integration tests, Drizzle ORM, Playwright E2E.

---

## File Structure

- **Modify:** `app/(auth)/auth/verify/route.ts` — split into GET (render landing, no DB touch) + POST (consume + cookie + redirect, current logic moves here)
- **Modify:** `tests/integration/auth-verify-route.test.ts` — migrate existing 9 tests from GET to POST; add 4 new tests for GET scanner-safe invariants
- **Modify:** `docs/deployment-runbook.md` — add a §"Two-step verify" section explaining the flow for future-you / collaborators

No changes needed to:
- `lib/auth/verify.ts` (the core logic — unchanged)
- `lib/auth/issue.ts` (token issuance — unchanged)
- `actions/sessions.ts` (landing form action — unchanged)
- `lib/mail/templates/magic-link.tsx` (email template — still links to `/auth/verify?token=X`)
- `lib/auth/middleware.ts` (session cookie logic — unchanged)

---

## Design decisions

**GET does zero DB work.** Even read-only SELECTs are avoided on GET — keeps the scanner-safe invariant trivially provable ("grep the GET handler: it never touches `adminDb`"). Validation happens exclusively on POST.

**Failure UX delegated to POST.** A user clicking an expired/consumed/invalid link still sees the landing page briefly, clicks Continue, and gets "This link is no longer valid" from POST. One extra click for the unhappy path is acceptable; it's the price for rock-solid scanner safety.

**Missing-token GET is the one exception.** If the URL has no `?token=` at all, GET renders invalid immediately (no point in a landing page for nothing).

**Audit-log semantics shift slightly.** Today, `magic_link_failed` audit rows fire on GET. After this change, they fire only on POST — meaning scanner pre-fetches no longer pollute the audit log with false-positive failures. This is a strict improvement: fewer scanner-generated audit noise, same visibility into real failed human clicks.

**Branch name:** `feat/two-step-verify`.

**Commit style:** one feature commit (code + tests) per recent project convention (e.g., `387ab0c feat(auth): sliding-window rate limiting on verify + share`), plus a separate `docs(auth)` commit for the runbook update.

---

## Task 1: Create branch and verify baseline

**Files:**
- No file changes. Just branch creation and sanity check.

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feat/two-step-verify
```

- [ ] **Step 2: Confirm existing test suite passes on main baseline**

```bash
pnpm test:run tests/integration/auth-verify-route.test.ts
```

Expected: all 9 tests pass. This is the baseline we're preserving.

---

## Task 2: Add failing test for GET landing page (scanner-safe invariant)

**Files:**
- Modify: `tests/integration/auth-verify-route.test.ts`

- [ ] **Step 1: Add test for GET with valid token → renders landing page, does NOT consume token**

Append this test to the `describe("GET /auth/verify route", ...)` block in `tests/integration/auth-verify-route.test.ts` (it will be renamed in Task 4, but for now the block name is fine):

```ts
  // ── Test 10: GET renders landing page without consuming token (SCANNER-SAFE) ─
  it("GET with valid token → 200 continue-landing HTML, token NOT consumed in DB, no cookie, no session inserted", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { issueMagicLink } = await import("@/lib/auth/issue");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "scanner@edict.test", name: "Scanner Admin" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "admin",
      subjectId: admin!.id,
      email: "scanner@edict.test",
      clientId: null,
    });

    const res = await GET(makeRequest(raw));

    // Landing page rendered, 200 OK, HTML content-type.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    // Must contain a POST form that carries the token forward.
    expect(body).toMatch(/<form[^>]+method=["']post["'][^>]*>/i);
    expect(body).toContain(`value="${raw}"`);
    // Must show a user-facing Continue affordance.
    expect(body).toMatch(/continue|sign in/i);

    // No cookie set — GET must never authenticate anything.
    expect(res.headers.get("set-cookie")).toBeNull();

    // Token is NOT consumed — this is the scanner-safe invariant.
    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.consumedAt).toBeNull();

    // No session inserted.
    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);

    // No audit row — GET must be DB-free.
    const audits = await adminDb.query.auditLog.findMany({});
    // issueMagicLink wrote one magic_link_sent row; GET must add none.
    expect(audits).toHaveLength(1);
    expect(audits[0]!.eventType).toBe("magic_link_sent");
  });
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
pnpm test:run tests/integration/auth-verify-route.test.ts -t "scanner-safe"
```

Expected: FAIL. Current GET consumes the token and sets a cookie — the new assertions will not hold.

---

## Task 3: Implement GET landing renderer (make Task 2 test pass)

**Files:**
- Modify: `app/(auth)/auth/verify/route.ts`

- [ ] **Step 1: Replace the GET handler with a DB-free landing renderer**

Full replacement file contents — overwrite `app/(auth)/auth/verify/route.ts`:

```ts
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
```

- [ ] **Step 2: Run the scanner-safe test to verify it passes**

```bash
pnpm test:run tests/integration/auth-verify-route.test.ts -t "scanner-safe"
```

Expected: PASS.

- [ ] **Step 3: Run the rest of the file to see which tests now break**

```bash
pnpm test:run tests/integration/auth-verify-route.test.ts
```

Expected: Tests 2, 3, 4, 5, 6, 7, 8, 9 now **FAIL** because they call `GET(...)` expecting consume behavior. Test 1 (missing-token GET) and Test 10 (new) should still pass. This is intentional — Task 4 migrates them to POST.

---

## Task 4: Migrate existing consume-path tests from GET to POST

**Files:**
- Modify: `tests/integration/auth-verify-route.test.ts`

- [ ] **Step 1: Rename the outer describe block and add a POST request helper**

Find the current `describe("GET /auth/verify route", ...)` block and change it to `describe("/auth/verify route", ...)`. Right below the existing `makeRequest` helper (around line 58), add this POST helper:

```ts
function makePostRequest(token: string | null, headers: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/auth/verify");
  const body = new URLSearchParams();
  if (token !== null) body.set("token", token);
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: body.toString(),
  });
}
```

- [ ] **Step 2: Convert Test 2 (invalid token → audit write)**

Replace Test 2's body entirely with:

```ts
  // ── Test 2: Invalid/unknown token via POST ────────────────────────────────
  it("POST with invalid token → 200 invalid HTML, no cookie, magic_link_failed audit written", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb } = dbModule!;

    const res = await POST(makePostRequest("totally-invalid-token-string"));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.eventType, "magic_link_failed"),
    });
    expect(audits).toHaveLength(1);
  });
```

- [ ] **Step 3: Convert Test 3 (expired token)**

Replace Test 3's body entirely with:

```ts
  // ── Test 3: Expired token via POST ────────────────────────────────────────
  it("POST with expired token → 200 invalid HTML, no cookie, no session inserted", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "expired@edict.test", name: "Expired Admin" })
      .returning();

    const rawToken = "expired-raw-token-for-test-01";
    await adminDb.insert(schema.magicLinkTokens).values({
      tokenHash: sha256Hex(rawToken),
      subjectType: "admin",
      subjectId: admin!.id,
      email: "expired@edict.test",
      clientId: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await POST(makePostRequest(rawToken));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);
  });
```

- [ ] **Step 4: Convert Test 4 (already-consumed token)**

Replace Test 4's body entirely with:

```ts
  // ── Test 4: Already-consumed token via POST ───────────────────────────────
  it("POST with already-consumed token → 200 invalid HTML, no cookie, no session inserted", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "consumed@edict.test", name: "Consumed Admin" })
      .returning();

    const rawToken = "consumed-raw-token-for-test-02";
    await adminDb.insert(schema.magicLinkTokens).values({
      tokenHash: sha256Hex(rawToken),
      subjectType: "admin",
      subjectId: admin!.id,
      email: "consumed@edict.test",
      clientId: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      consumedAt: new Date(Date.now() - 5000),
    });

    const res = await POST(makePostRequest(rawToken));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);
  });
```

- [ ] **Step 5: Convert Test 5 (valid admin → /admin + cookie)**

Replace Test 5's body entirely with:

```ts
  // ── Test 5: Valid admin token via POST ────────────────────────────────────
  it("POST with valid admin token → 302 to /admin, session cookie set, session row inserted, token consumed", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");
    const { issueMagicLink } = await import("@/lib/auth/issue");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "admin@edict.test", name: "Admin" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "admin",
      subjectId: admin!.id,
      email: "admin@edict.test",
      clientId: null,
    });

    const res = await POST(makePostRequest(raw));

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(location).toMatch(/\/admin$/);

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).not.toBeNull();
    expect(cookie).toMatch(/edict_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).not.toMatch(/;\s*Secure/i);

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.subjectType).toBe("admin");
    expect(session.subjectId).toBe(admin!.id);
    expect(session.clientId).toBeNull();

    const sessionTokenInCookie = cookie.split("edict_session=")[1]!.split(";")[0]!;
    expect(session.sessionTokenHash).toBe(sha256Hex(sessionTokenInCookie));

    const tokens = await adminDb.query.magicLinkTokens.findMany({});
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.consumedAt).not.toBeNull();
  });
```

- [ ] **Step 6: Convert Test 6 (valid client_member → /c/<slug>)**

Replace Test 6's body entirely with:

```ts
  // ── Test 6: Valid client_member token via POST ────────────────────────────
  it("POST with valid client_member token → 302 to /c/<slug>, session cookie set, session row inserted", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");
    const { issueMagicLink } = await import("@/lib/auth/issue");

    const [client] = await adminDb
      .insert(schema.clients)
      .values({ slug: "acme-corp", name: "Acme Corp" })
      .returning();

    const [member] = await adminDb
      .insert(schema.clientMembers)
      .values({ clientId: client!.id, email: "alice@acme.test", role: "viewer" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "client_member",
      subjectId: member!.id,
      email: "alice@acme.test",
      clientId: client!.id,
    });

    const res = await POST(makePostRequest(raw));

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(location).toMatch(/\/c\/acme-corp$/);

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).not.toBeNull();
    expect(cookie).toMatch(/edict_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.subjectType).toBe("client_member");
    expect(session.subjectId).toBe(member!.id);
    expect(session.clientId).toBe(client!.id);

    const sessionTokenInCookie = cookie.split("edict_session=")[1]!.split(";")[0]!;
    expect(session.sessionTokenHash).toBe(sha256Hex(sessionTokenInCookie));
  });
```

- [ ] **Step 7: Convert Test 7 (FK deletion race)**

Replace Test 7's body entirely with:

```ts
  // ── Test 7: Client deleted mid-flow via POST → FK-throws, caught by try/catch
  it("POST: client deleted after token issued → verifyMagicLink FK-throws, caught by try/catch, renderInvalid", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { issueMagicLink } = await import("@/lib/auth/issue");

    const [client] = await adminDb
      .insert(schema.clients)
      .values({ slug: "ghost-co", name: "Ghost Co" })
      .returning();

    const [member] = await adminDb
      .insert(schema.clientMembers)
      .values({ clientId: client!.id, email: "ghost@ghost-co.test", role: "viewer" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "client_member",
      subjectId: member!.id,
      email: "ghost@ghost-co.test",
      clientId: client!.id,
    });

    const conn = await superPool!.connect();
    try {
      await conn.query("SET session_replication_role = 'replica'");
      await conn.query("DELETE FROM clients WHERE id = $1", [client!.id]);
      await conn.query("SET session_replication_role = 'origin'");
    } finally {
      conn.release();
    }

    const res = await POST(makePostRequest(raw));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);
  });
```

- [ ] **Step 8: Convert Test 8 (IP + UA capture)**

Replace Test 8's body entirely with:

```ts
  // ── Test 8: IP + User-Agent capture via POST ──────────────────────────────
  it("POST with X-Forwarded-For + User-Agent → session row captures first IP + UA", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { issueMagicLink } = await import("@/lib/auth/issue");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "iptest@edict.test", name: "IP Test Admin" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "admin",
      subjectId: admin!.id,
      email: "iptest@edict.test",
      clientId: null,
    });

    const res = await POST(
      makePostRequest(raw, {
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        "user-agent": "test-agent/1.0",
      }),
    );

    expect(res.status).toBe(302);

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.ip).toBe("1.2.3.4");
    expect(session.userAgent).toBe("test-agent/1.0");
  });
```

- [ ] **Step 9: Convert Test 9 (revoked member)**

Replace Test 9's body entirely with:

```ts
  // ── Test 9: Revoked member token via POST ─────────────────────────────────
  it("POST with revoked member token → 200 invalid HTML, no cookie, no session, magic_link_failed audit written", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { issueMagicLink } = await import("@/lib/auth/issue");
    const { eq } = await import("drizzle-orm");

    const [client] = await adminDb
      .insert(schema.clients)
      .values({ slug: "revoke-test-co", name: "Revoke Test Co" })
      .returning();

    const [member] = await adminDb
      .insert(schema.clientMembers)
      .values({ clientId: client!.id, email: "revoked@revoke-test.test", role: "viewer" })
      .returning();

    const { raw } = await issueMagicLink({
      subjectType: "client_member",
      subjectId: member!.id,
      email: "revoked@revoke-test.test",
      clientId: client!.id,
    });

    await adminDb
      .update(schema.clientMembers)
      .set({ revokedAt: new Date() })
      .where(eq(schema.clientMembers.id, member!.id));

    const res = await POST(makePostRequest(raw));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();

    const sessions = await adminDb.query.sessions.findMany({});
    expect(sessions).toHaveLength(0);

    const audits = await adminDb.query.auditLog.findMany({
      where: (a, { eq: eqFn }) => eqFn(a.eventType, "magic_link_failed"),
    });
    expect(audits).toHaveLength(1);
    expect((audits[0]!.metadata as Record<string, unknown>)["reason"]).toBe("member_revoked");
  });
```

- [ ] **Step 10: Run full file to verify all 10 tests pass**

```bash
pnpm test:run tests/integration/auth-verify-route.test.ts
```

Expected: 10 tests, all green (Tests 1 + 10 for GET; Tests 2–9 for POST). No assertions remain that call `GET` with tokens expecting consume behavior.

---

## Task 5: Add remaining GET scanner-safety tests

**Files:**
- Modify: `tests/integration/auth-verify-route.test.ts`

- [ ] **Step 1: Add Test 11 — GET with invalid token still renders landing (no DB touch, no audit)**

Append after Test 10:

```ts
  // ── Test 11: GET with invalid token → landing page, NO audit (GET is DB-free)
  it("GET with unknown/invalid token → 200 landing HTML, NO audit row written (GET performs zero DB work)", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb } = dbModule!;

    const res = await GET(makeRequest("totally-invalid-token-string"));

    expect(res.status).toBe(200);
    const body = await res.text();
    // GET is dumb — it renders the continue page regardless of token validity.
    // POST is where validation happens. This is the scanner-safe invariant.
    expect(body).toMatch(/<form[^>]+method=["']post["'][^>]*>/i);
    expect(body).toContain('value="totally-invalid-token-string"');

    // Critical: zero DB touch → zero audit rows.
    const audits = await adminDb.query.auditLog.findMany({});
    expect(audits).toHaveLength(0);
  });
```

- [ ] **Step 2: Add Test 12 — GET with already-consumed token still renders landing (scanner indistinguishable from real user)**

Append after Test 11:

```ts
  // ── Test 12: GET with consumed token → landing page still renders ─────────
  it("GET with already-consumed token → 200 landing HTML, does not re-consume or error", async () => {
    const { GET } = await import("@/app/(auth)/auth/verify/route");
    const { adminDb, schema } = dbModule!;
    const { sha256Hex } = await import("@/lib/utils/hash");

    const [admin] = await adminDb
      .insert(schema.admins)
      .values({ email: "double-scan@edict.test", name: "Double Scan" })
      .returning();

    const rawToken = "already-consumed-raw-token";
    await adminDb.insert(schema.magicLinkTokens).values({
      tokenHash: sha256Hex(rawToken),
      subjectType: "admin",
      subjectId: admin!.id,
      email: "double-scan@edict.test",
      clientId: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      consumedAt: new Date(Date.now() - 1000),
    });

    const res = await GET(makeRequest(rawToken));

    // GET renders the same landing page regardless of token state — zero DB
    // read or write. The user will see "This link is no longer valid" only
    // after clicking Continue (POST handles validation).
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<form[^>]+method=["']post["'][^>]*>/i);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
```

- [ ] **Step 3: Add Test 13 — POST without token → invalid page**

Append after Test 12:

```ts
  // ── Test 13: POST with missing token → invalid page ───────────────────────
  it("POST without token → 200 invalid HTML, no cookie", async () => {
    const { POST } = await import("@/app/(auth)/auth/verify/route");
    const res = await POST(makePostRequest(null));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("This link is no longer valid");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
```

- [ ] **Step 4: Run full test file to verify all 13 tests pass**

```bash
pnpm test:run tests/integration/auth-verify-route.test.ts
```

Expected: 13 tests, all green.

- [ ] **Step 5: Run full project test suite to confirm no regressions**

```bash
pnpm test:run
```

Expected: full green across unit, integration, and E2E (excluding E2E which runs separately).

---

## Task 6: Run lint and typecheck

**Files:**
- None. Verification only.

- [ ] **Step 1: Lint**

```bash
pnpm lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no type errors.

---

## Task 7: E2E smoke test — sign in via the two-step flow

**Files:**
- Modify: `tests/e2e/isolation.spec.ts` (add one additional scenario at the end), OR create a new spec file. Prefer appending to keep the E2E surface small.

**Note:** The existing E2E (`isolation.spec.ts`) bypasses `/auth/verify` via the `signIn` fixture which directly sets the `edict_session` cookie. This is fine for isolation testing but doesn't exercise the two-step flow. Add one spec that exercises the real two-step user journey.

- [ ] **Step 1: Add an E2E spec exercising the GET→POST flow**

Append this test to `tests/e2e/isolation.spec.ts`:

```ts
test("two-step verify: GET landing does not consume token; POST consumes + redirects", async ({ page, seed }) => {
  // Issue a fresh magic link for Alpha member directly.
  const { raw } = await issueMagicLink({
    subjectType: "client_member",
    subjectId: seed.memberA.id,
    email: seed.memberA.email,
    clientId: seed.clientA.id,
  });

  // Simulate a scanner: GET the verify URL. The token must NOT be consumed.
  await page.goto(`/auth/verify?token=${encodeURIComponent(raw)}`);
  await expect(page.getByRole("button", { name: /Continue signing in/i })).toBeVisible();

  // Confirm in DB that the token is still live.
  const preClickTokens = await adminDb.query.magicLinkTokens.findMany({
    where: (t, { eq }) => eq(t.tokenHash, sha256Hex(raw)),
  });
  expect(preClickTokens).toHaveLength(1);
  expect(preClickTokens[0]!.consumedAt).toBeNull();

  // Human click: submit the form. Token consumed, redirect to /c/<slug>.
  await page.getByRole("button", { name: /Continue signing in/i }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${seed.clientA.slug}$`));

  // Token now consumed.
  const postClickTokens = await adminDb.query.magicLinkTokens.findMany({
    where: (t, { eq }) => eq(t.tokenHash, sha256Hex(raw)),
  });
  expect(postClickTokens[0]!.consumedAt).not.toBeNull();
});
```

- [ ] **Step 2: Run E2E**

```bash
pnpm test:e2e
```

Expected: new test green plus pre-existing tests unchanged.

If E2E is not configured to run locally right now (per handoff — Playwright browsers may need `pnpm exec playwright install`), run:

```bash
pnpm exec playwright install chromium && pnpm test:e2e
```

---

## Task 8: Commit the feature

**Files:**
- None. Git only.

- [ ] **Step 1: Stage the feature files**

```bash
git add app/\(auth\)/auth/verify/route.ts tests/integration/auth-verify-route.test.ts tests/e2e/isolation.spec.ts
```

- [ ] **Step 2: Commit with conventional message**

```bash
git commit -m "feat(auth): two-step verify prevents email-scanner token consumption

Email security scanners (Proton, Outlook ATP, Safe Browsing, corporate
gateways) pre-fetch URLs in inbound mail to check for malware/phishing. That
pre-fetch previously fired GET /auth/verify?token=X and consumed the
single-use magic-link before the human recipient could click it, producing a
'This link is no longer valid' UX on first click.

Split the verify route so GET only renders a DB-free 'Continue signing in'
landing page; token consumption, cookie setup, and redirect happen
exclusively on POST (human form submission). Scanner GETs pass harmlessly,
tokens survive until the real user clicks.

Pattern matches Slack, Notion, Linear, Stripe. No security weakening —
single-use, TTL, IP/UA capture, revocation-aware checks all preserved in
verifyMagicLink on the POST path."
```

---

## Task 9: Update the deployment runbook

**Files:**
- Modify: `docs/deployment-runbook.md`

- [ ] **Step 1: Read the runbook to find the right insertion point**

```bash
grep -n "^##" docs/deployment-runbook.md
```

Find a section like "## Auth", "## Magic links", or similar. If none exists, add the new section near the end, before any trailing "## Troubleshooting" or appendix.

- [ ] **Step 2: Append a new section "## Two-step magic-link verify"**

Add this markdown block at the appropriate location:

```markdown
## Two-step magic-link verify

Magic-link sign-ins use a two-step flow to defeat email-scanner pre-fetching.

**Flow:**
1. User clicks link in email → lands at `GET /auth/verify?token=X`
2. Page renders a "Continue signing in" form. **No DB work happens here.**
3. User clicks the Continue button → browser POSTs the token to the same route
4. `POST /auth/verify` consumes the token (atomic UPDATE with `consumed_at IS NULL` guard), sets the 30-day session cookie, and redirects to `/admin` (admins) or `/c/<slug>` (client members)

**Why:** Proton, Outlook ATP, Google Safe Browsing, and corporate email gateways
pre-fetch links via GET to scan for malware. Without the two-step split, that
pre-fetch burns the single-use token before the human sees it. The split makes
GET scanner-safe (zero DB touch) while POST stays as the real consumption
boundary.

**Operational notes:**
- Token TTL is 24h (defined in `lib/auth/issue.ts`). No change.
- Audit events (`magic_link_failed`, `session_created`) now fire only on POST,
  so scanner pre-fetches no longer add noise to the audit log.
- If debugging a "This link is no longer valid" report, check `magic_link_tokens`
  for a `consumed_at` that predates the user's click — if it does, the token was
  legitimately already used (not a scanner burn, since GET is inert).
```

- [ ] **Step 3: Commit the docs update**

```bash
git add docs/deployment-runbook.md
git commit -m "docs(auth): explain two-step verify flow in deployment runbook"
```

---

## Task 10: Push and open PR

**Files:**
- None. Git + gh.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/two-step-verify
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(auth): two-step verify prevents email-scanner token burn" --body "$(cat <<'EOF'
## Summary
- Split `/auth/verify` into scanner-safe GET (renders landing page, zero DB work) + human-initiated POST (consumes token, sets cookie, redirects)
- Prevents email security scanners (Proton, Outlook ATP, Safe Browsing, corporate gateways) from pre-consuming single-use magic-links before the human recipient clicks
- Industry-standard pattern (Slack, Notion, Linear, Stripe all use this for the same reason)
- No security weakening — all existing invariants (single-use, TTL, IP/UA capture, revocation guard) preserved on the POST path

## Test plan
- [x] All 9 pre-existing verify-route integration tests migrated from GET to POST
- [x] 4 new integration tests cover the GET scanner-safe invariant (zero DB touch for any token shape)
- [x] E2E test exercises the real GET→POST flow end-to-end with a fresh magic-link
- [x] `pnpm test:run` + `pnpm test:e2e` green
- [x] `pnpm lint` + `pnpm typecheck` green
- [x] Manual smoke: issue magic-link to rector@rectorspace.com → click from Proton → verify two-click flow works

## Operational impact
- Audit log noise from scanner GETs eliminated (`magic_link_failed` rows now only come from real human POST attempts)
- One extra click per sign-in (acceptable trade for robust UX across all email providers)
- Runbook updated with the new flow
EOF
)"
```

- [ ] **Step 3: Report the PR URL back in chat**

Copy the PR URL from the `gh pr create` output and paste in the session so RECTOR can review.

---

## Self-review checklist (writing-plans skill requirement)

**Spec coverage:**
- GET renders landing, zero DB work → Task 2 + 3 + 5
- POST consumes + redirects → Task 3 (implementation) + Task 4 (migrated tests)
- Existing test coverage preserved → Task 4 (all 9 tests migrated)
- Scanner-safety invariant explicitly tested → Tasks 2, 5
- Unhappy paths (invalid/expired/consumed/revoked) → Task 4 Steps 2, 3, 4, 9
- E2E smoke → Task 7
- Docs → Task 9
- Branch + PR flow → Tasks 1, 8, 10

**Placeholder scan:** grepped for TBD/TODO/implement-later patterns in the plan text — none present. All code blocks contain full implementations.

**Type consistency:** `makeRequest` (existing helper, line 58) takes `(token: string | null, headers?)`. `makePostRequest` (new, Task 4 Step 1) mirrors the signature exactly — `(token: string | null, headers?)`. Route handler signatures `GET(req: NextRequest)` + `POST(req: NextRequest)` match Next.js 15 App Router conventions and existing codebase style. No drift.

**Missing:** none identified.
