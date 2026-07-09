// E2E: navigating to a note with cache-busting query params surfaces the
// UrlSanitizeDebugPanel (dev-only) showing original vs sanitized URL and the
// list of stripped params.
import { expect, test } from "@playwright/test";

test("UrlSanitizeDebugPanel shows original/sanitized/removed when ?v= is present", async ({ page }) => {
  // `foo` is whitelisted; `v`, `ver`, `t` are cache-busters that must be stripped.
  await page.goto("/my-note?foo=bar&v=123&ver=2&t=999");

  const panel = page.locator('[data-url-sanitize-debug-panel="true"]');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // At least one strip event recorded.
  await expect(panel).toHaveAttribute("data-event-count", /[1-9]\d*/);

  const firstEvent = panel.locator("[data-strip-event]").first();
  await expect(firstEvent).toContainText("original:");
  await expect(firstEvent).toContainText("/my-note?foo=bar&v=123&ver=2&t=999");
  await expect(firstEvent).toContainText("sanitized:");
  await expect(firstEvent).toContainText("/my-note?foo=bar");
  await expect(firstEvent).toContainText("removed:");
  // All three cache-busters listed (order preserved from URLSearchParams).
  await expect(firstEvent).toContainText(/v.*ver.*t/);
});

test("UrlSanitizeDebugPanel stays hidden when only whitelisted params are present", async ({ page }) => {
  await page.goto("/my-note?foo=bar");
  const panel = page.locator('[data-url-sanitize-debug-panel="true"]');
  // Give the effect a tick to run; panel must never appear.
  await page.waitForTimeout(300);
  await expect(panel).toHaveCount(0);
});
