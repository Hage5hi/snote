// Regression coverage for expectToastLifecycle from e2e/helpers/toast.ts.
//
// We deliberately inject a sonner-shaped toast tree (matching the markup
// the real `sonner` library renders) so the lifecycle helper exercises
// the same selectors, ARIA semantics, and DOM hierarchy it sees in
// production. Two regression cases:
//
//   1. "Stuck" toast → never auto-dismisses ⇒ helper must FAIL.
//   2. "Normal" toast → dismisses after a short delay ⇒ helper must PASS.
//
// If someone weakens expectToastLifecycle (e.g. drops the `toBeHidden`
// assertion), case (1) flips from passing → failing and surfaces the
// regression before it reaches real toast sites (Lock, Share, Rename).
import { test, expect, type Page } from "@playwright/test";
import {
  expectToastLifecycle,
  TOAST_DISMISS_TIMEOUT,
  TOAST_MIN_VISIBLE_MS,
  TOAST_TIMEOUT,
} from "./helpers/toast";

/**
 * Mounts a sonner-shaped toast region + a single toast item into the page.
 * Mirrors the DOM that sonner v1 renders: `[data-sonner-toaster]` wrapping
 * an `<ol>` with `<li data-sonner-toast role="status" aria-live="polite">`
 * children, each containing a `[data-content]` title node.
 *
 * Returns nothing — caller queries by the same selectors used in real specs.
 */
async function mountSonnerToast(
  page: Page,
  opts: { text: string; testid: string; autoDismissAfterMs?: number },
) {
  await page.evaluate(({ text, testid, autoDismissAfterMs }) => {
    // Region (created once).
    let region = document.querySelector<HTMLElement>("[data-sonner-toaster]");
    if (!region) {
      region = document.createElement("section");
      region.setAttribute("data-sonner-toaster", "");
      region.setAttribute("aria-label", "Notifications");
      region.style.cssText =
        "position:fixed;top:16px;right:16px;z-index:9999;pointer-events:auto;";
      const list = document.createElement("ol");
      list.setAttribute("tabindex", "-1");
      region.appendChild(list);
      document.body.appendChild(region);
    }
    const list = region.querySelector("ol")!;

    // Toast item — mirrors sonner's shape.
    const li = document.createElement("li");
    li.setAttribute("data-sonner-toast", "");
    li.setAttribute("data-testid", testid);
    li.setAttribute("data-type", "success");
    li.setAttribute("data-visible", "true");
    li.setAttribute("role", "status");
    li.setAttribute("aria-live", "polite");
    li.setAttribute("aria-atomic", "true");
    li.style.cssText =
      "background:#1f1f1f;color:#fff;border-radius:8px;padding:10px 14px;margin-bottom:8px;box-shadow:0 4px 12px rgba(0,0,0,.3);";

    const content = document.createElement("div");
    content.setAttribute("data-content", "");
    const title = document.createElement("div");
    title.setAttribute("data-title", "");
    title.textContent = text;
    content.appendChild(title);
    li.appendChild(content);
    list.appendChild(li);

    if (typeof autoDismissAfterMs === "number") {
      // Sonner animates out by toggling data-visible + data-removed before
      // unmounting. We mirror that so any future selectors that key off
      // `data-visible` keep working.
      window.setTimeout(() => {
        li.setAttribute("data-visible", "false");
        li.setAttribute("data-removed", "true");
        // Final unmount one frame later (matches sonner's exit anim).
        window.setTimeout(() => li.remove(), 50);
      }, autoDismissAfterMs);
    }
  }, opts);
}

test.describe("toast lifecycle helper (regression)", () => {
  test("env-configured thresholds are sane", () => {
    expect(TOAST_TIMEOUT).toBeGreaterThan(0);
    expect(TOAST_DISMISS_TIMEOUT).toBeGreaterThan(0);
    expect(TOAST_MIN_VISIBLE_MS).toBeGreaterThanOrEqual(0);
    // Dismiss window must exceed the min-visible floor, else a passing
    // toast could never satisfy both gates.
    expect(TOAST_DISMISS_TIMEOUT).toBeGreaterThan(TOAST_MIN_VISIBLE_MS);
  });

  test("a stuck sonner-shaped toast is caught by expectToastLifecycle", async ({
    page,
  }) => {
    await page.goto("about:blank");
    await mountSonnerToast(page, {
      text: "Stuck toast — should be dismissed",
      testid: "stuck-toast",
      // no autoDismissAfterMs ⇒ never disappears
    });

    // Locate the toast the way real specs do: text inside the sonner item.
    const stuck = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Stuck toast" });

    await expect(stuck).toBeVisible();
    await expect(stuck).toHaveAttribute("role", "status");
    await expect(stuck).toHaveAttribute("aria-live", "polite");

    // Helper must reject because the toast never hides.
    let helperThrew = false;
    try {
      await expectToastLifecycle(stuck);
    } catch {
      helperThrew = true;
    }
    expect(helperThrew).toBe(true);

    // Cleanup so other tests don't see the stuck node.
    await page.evaluate(() =>
      document.querySelector("[data-sonner-toaster]")?.remove(),
    );
  });

  test("a normal sonner-shaped toast that auto-dismisses passes expectToastLifecycle", async ({
    page,
  }) => {
    await page.goto("about:blank");
    await mountSonnerToast(page, {
      text: "OK toast",
      testid: "ok-toast",
      // Dismiss well after the min-visible floor but well within the
      // configured dismiss window.
      autoDismissAfterMs: TOAST_MIN_VISIBLE_MS + 400,
    });

    const ok = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "OK toast" });

    await expectToastLifecycle(ok);
  });
});
