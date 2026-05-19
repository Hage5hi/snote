// Regression coverage for expectToastLifecycle from e2e/helpers/toast.ts.
//
// This deliberately injects a toast-like element that NEVER auto-dismisses
// (the regression we're guarding against) and asserts that the lifecycle
// helper detects it by failing the dismissal step.
//
// If someone weakens expectToastLifecycle (e.g. drops the `toBeHidden`
// assertion), this test will flip from pass → fail and surface the
// regression in CI before it reaches a real toast site.
import { test, expect } from "@playwright/test";
import {
  expectToastLifecycle,
  TOAST_DISMISS_TIMEOUT,
  TOAST_MIN_VISIBLE_MS,
  TOAST_TIMEOUT,
} from "./helpers/toast";

test.describe("toast lifecycle helper (regression)", () => {
  test("env-configured thresholds are positive numbers", () => {
    expect(TOAST_TIMEOUT).toBeGreaterThan(0);
    expect(TOAST_DISMISS_TIMEOUT).toBeGreaterThan(0);
    expect(TOAST_MIN_VISIBLE_MS).toBeGreaterThanOrEqual(0);
    // Dismiss window must be larger than the minimum-visible floor, otherwise
    // a passing toast could never satisfy both gates.
    expect(TOAST_DISMISS_TIMEOUT).toBeGreaterThan(TOAST_MIN_VISIBLE_MS);
  });

  test("a stuck (never-dismissing) toast is caught by expectToastLifecycle", async ({
    page,
  }) => {
    await page.goto("about:blank");
    // Inject a fixed element that mimics a sonner toast but never disappears.
    await page.evaluate(() => {
      const el = document.createElement("div");
      el.setAttribute("data-testid", "stuck-toast");
      el.textContent = "Stuck toast — should be dismissed";
      el.style.cssText =
        "position:fixed;top:16px;right:16px;padding:8px 12px;background:#222;color:#fff;";
      document.body.appendChild(el);
    });

    const stuck = page.getByTestId("stuck-toast");

    // Sanity: toast is visible right now.
    await expect(stuck).toBeVisible();

    // Run the helper with a tightened dismiss window so the test stays fast,
    // then assert it threw. We do this by overriding the env-driven timeout
    // locally via a small wrapper.
    let threw = false;
    try {
      // Re-implement the same shape inline but with a short timeout so the
      // regression case fails within ~1s instead of TOAST_DISMISS_TIMEOUT.
      await expect(stuck).toBeVisible({ timeout: 1_000 });
      await page.waitForTimeout(TOAST_MIN_VISIBLE_MS);
      await expect(stuck).toBeHidden({ timeout: 1_000 });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // And confirm the shared helper itself rejects on the same stuck node
    // (uses real configured timeouts — this is the contract under test).
    let helperThrew = false;
    try {
      await expectToastLifecycle(stuck);
    } catch {
      helperThrew = true;
    }
    expect(helperThrew).toBe(true);
  });

  test("a normal toast that auto-dismisses passes expectToastLifecycle", async ({
    page,
  }) => {
    await page.goto("about:blank");
    await page.evaluate((minVisible) => {
      const el = document.createElement("div");
      el.setAttribute("data-testid", "ok-toast");
      el.textContent = "OK";
      document.body.appendChild(el);
      // Auto-dismiss safely after the minimum-visible floor.
      window.setTimeout(() => el.remove(), minVisible + 300);
    }, TOAST_MIN_VISIBLE_MS);

    const ok = page.getByTestId("ok-toast");
    await expectToastLifecycle(ok);
  });
});
