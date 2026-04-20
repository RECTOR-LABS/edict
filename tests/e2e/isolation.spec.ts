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

  // Consume the token. failOnStatusCode: false allows non-2xx responses.
  // verifyMagicLink checks member.revokedAt before creating a session, so it
  // must return the "invalid link" HTML page (200) rather than a 302+cookie.
  const res = await request.get(`/auth/verify?token=${raw}`, {
    failOnStatusCode: false,
  });

  // Verify must NOT set a session cookie for a revoked member.
  const setCookie = res.headers()["set-cookie"] ?? "";
  expect(setCookie).not.toMatch(/edict_session=/);

  // The response body must render the invalid-link page, not a redirect to /c/A.
  // Status 200 (not 302) confirms the revocation gate fired.
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
