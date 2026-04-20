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
