import { eq } from "drizzle-orm";
import { adminDb, schema } from "@/lib/db";
import { revokeMember } from "@/lib/db/queries/members";
import { issueMagicLink } from "@/lib/auth/issue";
import { sha256Hex } from "@/lib/utils/hash";
import { test, expect, signIn } from "./fixtures";

test("A sees doc-1, not doc-2", async ({ page, request, seed }) => {
  const cookieA = await signIn(
    request,
    seed.memberA.email,
    seed.memberA.id,
    seed.clientA.id,
  );

  // Hardcoded origin — page.url() returns "about:blank" on a fresh Playwright
  // page, which is truthy, so the `|| fallback` pattern never fires and the
  // cookie is registered against the wrong origin. Always use the literal
  // base URL so the browser sends the cookie on subsequent requests to
  // http://127.0.0.1:3000.
  await page.context().addCookies([
    {
      name: "edict_session",
      value: cookieA,
      url: "http://127.0.0.1:3000",
    },
  ]);

  await page.goto(`/c/${seed.clientA.slug}`);

  // Positive assertion: Alpha's doc must be present.
  await expect(page.getByText("Doc for Alpha")).toBeVisible();

  // Negative assertion: Bravo's doc must be completely absent — this is
  // the tenant-isolation invariant. Count 0 beats `.not.toBeVisible()`
  // because a hidden element would still constitute a leak.
  await expect(page.getByText("Doc for Bravo")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Scenario 2: URL manipulation — member A cannot reach /c/B/d/docB by
// constructing the URL directly, even with a valid session cookie for A.
// The middleware/page must enforce tenant ownership before serving the doc.
// ---------------------------------------------------------------------------
test("A cannot reach /c/B/d/docB by URL manipulation", async ({ page, request, seed }) => {
  const cookieA = await signIn(request, seed.memberA.email, seed.memberA.id, seed.clientA.id);
  await page.context().addCookies([
    {
      name: "edict_session",
      value: cookieA,
      url: "http://127.0.0.1:3000",
    },
  ]);
  const res = await page.goto(`/c/${seed.clientB.slug}/d/${seed.docB1.slug}`);
  expect(res?.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// Scenario 3: Cookie swap — member A's valid session cookie presented on
// /c/B must be rejected because the session's clientId !== clientB's id.
// This tests that the middleware checks clientId, not just session validity.
// ---------------------------------------------------------------------------
test("A's cookie on /c/B is rejected as mismatch", async ({ page, request, seed }) => {
  const cookieA = await signIn(request, seed.memberA.email, seed.memberA.id, seed.clientA.id);
  await page.context().addCookies([
    {
      name: "edict_session",
      value: cookieA,
      url: "http://127.0.0.1:3000",
    },
  ]);
  const res = await page.goto(`/c/${seed.clientB.slug}`);
  expect(res?.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// Scenario 4: Revoked member — after revoking member A, any new magic-link
// issued for A must be rejected at /auth/verify. Even if verify completes
// without error (non-standard path), the resulting session must not grant
// access to /c/A.
// ---------------------------------------------------------------------------
test("revoked member's new magic-link fails", async ({ request, seed }) => {
  // Revoke A via the established query (same pattern used by the admin API).
  await revokeMember(seed.memberA.id);

  // Issue a fresh magic-link for the now-revoked member.
  const { raw } = await issueMagicLink({
    subjectType: "client_member",
    subjectId: seed.memberA.id,
    email: seed.memberA.email,
    clientId: seed.clientA.id,
  });

  // POST the token — this is where the revocation guard inside verifyMagicLink
  // fires. GET only renders the landing page, so it is not the right place to
  // test the guard after the two-step split.
  const res = await request.post(`/auth/verify`, {
    form: { token: raw },
    maxRedirects: 0,
    failOnStatusCode: false,
  });

  // Verify must NOT set a session cookie for a revoked member.
  const setCookie = res.headers()["set-cookie"] ?? "";
  expect(setCookie).not.toMatch(/edict_session=/);

  // The response body must render the invalid-link page, not a redirect to /c/A.
  // Status 200 (not 302) confirms the revocation gate fired inside POST.
  expect(res.status()).toBe(200);
});

// ---------------------------------------------------------------------------
// Scenario 5: Revoked session — sign in successfully, then revoke the
// resulting session in the DB. A subsequent navigation must bounce to /.
// This closes the "stolen cookie after sign-out" attack vector.
// ---------------------------------------------------------------------------
test("revoked session bounces to /", async ({ page, request, seed }) => {
  const cookieA = await signIn(request, seed.memberA.email, seed.memberA.id, seed.clientA.id);

  // Revoke the session by its token hash — same invariant enforced by the
  // middleware's findActiveSessionByTokenHash check (revokedAt must be null).
  await adminDb
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.sessionTokenHash, sha256Hex(cookieA)));

  await page.context().addCookies([
    {
      name: "edict_session",
      value: cookieA,
      url: "http://127.0.0.1:3000",
    },
  ]);

  const res = await page.goto(`/c/${seed.clientA.slug}`);

  // After following the redirect chain, the final URL must be the root path.
  // A trailing slash on / is acceptable; /c/* would indicate a leak.
  expect(new URL(res!.url()).pathname).toBe("/");
});

// ---------------------------------------------------------------------------
// Scenario 6: Two-step verify flow — GET /auth/verify renders the landing page
// without consuming the token; the human click on Continue submits the POST
// form which consumes the token and issues the session cookie. This is the
// scanner-safety invariant from the user-agent perspective.
// ---------------------------------------------------------------------------
test("two-step verify: GET landing does not consume token; POST consumes + redirects", async ({ page, seed }) => {
  const { raw } = await issueMagicLink({
    subjectType: "client_member",
    subjectId: seed.memberA.id,
    email: seed.memberA.email,
    clientId: seed.clientA.id,
  });

  // Simulate the scanner (or the user's first navigation) — GET the verify URL.
  // Use the absolute localhost origin so the form POST and the server's 302
  // redirect Location header all resolve to the same hostname. Next.js
  // production mode generates absolute redirects from req.nextUrl.origin which
  // resolves to http://localhost:3000, not http://127.0.0.1:3000. If the
  // page.goto uses 127.0.0.1 but the 302 Location points to localhost, the
  // browser context switches hostnames and the edict_session cookie (set for
  // 127.0.0.1) would not be sent to localhost — breaking the auth check.
  const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  await page.goto(`${baseUrl}/auth/verify?token=${encodeURIComponent(raw)}`);
  await expect(page.getByRole("button", { name: /Continue signing in/i })).toBeVisible();

  // Confirm in DB that the token is still live. This is the scanner-safe
  // invariant — GET must never consume the token.
  const preClickTokens = await adminDb.query.magicLinkTokens.findMany({
    where: (t, { eq }) => eq(t.tokenHash, sha256Hex(raw)),
  });
  expect(preClickTokens).toHaveLength(1);
  expect(preClickTokens[0]!.consumedAt).toBeNull();

  // Human click: submit the form. Token consumed, redirect to /c/<slug>.
  await page.getByRole("button", { name: /Continue signing in/i }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${seed.clientA.slug}$`));

  // Token is now consumed — the UPDATE fired on POST.
  const postClickTokens = await adminDb.query.magicLinkTokens.findMany({
    where: (t, { eq }) => eq(t.tokenHash, sha256Hex(raw)),
  });
  expect(postClickTokens[0]!.consumedAt).not.toBeNull();
});
