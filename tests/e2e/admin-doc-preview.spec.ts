import { test, expect, adminSignIn, signIn } from "./fixtures";

const ADMIN_EMAIL = "admin@edict.test";

// ---------------------------------------------------------------------------
// Scenario 1: Admin happy path — edit page exposes a Preview link, clicking
// it navigates to /admin/docs/[id]/preview and renders the doc body inside
// the sandboxed iframe (HTML bodyType). This is the core of the feature:
// one click from edit to rendered view, without requiring the admin to join
// the client as a member.
// ---------------------------------------------------------------------------
test("admin clicks Preview on edit page and sees rendered doc", async ({ page, request, seed }) => {
  const cookie = await adminSignIn(request, ADMIN_EMAIL, seed.adminId);
  await page.context().addCookies([
    { name: "edict_session", value: cookie, url: "http://localhost:3000" },
  ]);

  await page.goto(`/admin/docs/${seed.docA1.id}`);

  // Preview link must be present alongside Share.
  const preview = page.getByRole("link", { name: /Preview/i });
  await expect(preview).toBeVisible();

  // Preview opens in a new tab (target="_blank") so the admin doesn't lose
  // any in-progress edits on the source tab.
  const [popup] = await Promise.all([page.waitForEvent("popup"), preview.click()]);
  await popup.waitForLoadState("domcontentloaded");

  await expect(popup).toHaveURL(new RegExp(`/admin/docs/${seed.docA1.id}/preview$`));
  await expect(popup.getByRole("heading", { name: /Doc for Alpha/ })).toBeVisible();
  await expect(popup.locator('iframe[title="Edict document"]')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Scenario 2: Admin can preview a doc belonging to a client they are NOT a
// member of. This is the whole point of a dedicated admin-preview route — it
// bypasses the client-member check so the admin can review docs for any
// tenant without polluting client_members with admin records.
// ---------------------------------------------------------------------------
test("admin can preview a doc for a client they are not a member of", async ({ page, request, seed }) => {
  const cookie = await adminSignIn(request, ADMIN_EMAIL, seed.adminId);
  await page.context().addCookies([
    { name: "edict_session", value: cookie, url: "http://localhost:3000" },
  ]);

  // docB1 belongs to clientB. Admin is not a client_member of B.
  const res = await page.goto(`/admin/docs/${seed.docB1.id}/preview`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /Doc for Bravo/ })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Scenario 3: Authorization — a client_member hitting the admin preview
// route must be bounced to /. The route is admin-only; a valid client
// session is not sufficient.
// ---------------------------------------------------------------------------
test("client_member cannot reach /admin/docs/[id]/preview", async ({ page, request, seed }) => {
  const cookie = await signIn(request, seed.memberA.email, seed.memberA.id, seed.clientA.id);
  await page.context().addCookies([
    { name: "edict_session", value: cookie, url: "http://localhost:3000" },
  ]);

  const res = await page.goto(`/admin/docs/${seed.docA1.id}/preview`);
  // requireAdminSession() redirects to / when session is not admin.
  expect(new URL(res!.url()).pathname).toBe("/");
});
