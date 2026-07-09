// E2E: the dev-only DiagnosticsPanel captures console warn/error, uncaught
// exceptions, unhandled promise rejections, and React render errors —
// exposing the component tree where the error occurred.

import { expect, test } from "@playwright/test";

test.describe("DiagnosticsPanel", () => {
  test("captures console.warn and console.error with badges", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator('[data-diagnostics-panel="true"]');
    await expect(panel).toBeVisible();

    await page.evaluate(() => {
      console.warn("test-warning-XYZ");
      console.error("test-error-XYZ");
    });

    await expect
      .poll(async () => Number(await panel.getAttribute("data-warn-count")))
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => Number(await panel.getAttribute("data-error-count")))
      .toBeGreaterThanOrEqual(1);

    // Expand and confirm both messages listed.
    await panel.locator("button", { hasText: /\[diag\]/ }).click();
    await expect(panel.locator('[data-diag-event][data-diag-kind="warn"]')).toContainText(
      "test-warning-XYZ",
    );
    await expect(panel.locator('[data-diag-event][data-diag-kind="error"]')).toContainText(
      "test-error-XYZ",
    );
  });

  test("captures window 'error' and 'unhandledrejection' events", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator('[data-diagnostics-panel="true"]');
    await expect(panel).toBeVisible();

    await page.evaluate(() => {
      // Uncaught exception via a queued microtask so it hits window.onerror
      // rather than becoming a React render error.
      setTimeout(() => {
        throw new Error("uncaught-XYZ");
      }, 0);
      // Unhandled rejection.
      Promise.reject(new Error("rejected-XYZ"));
    });

    await expect
      .poll(async () => Number(await panel.getAttribute("data-error-count")))
      .toBeGreaterThanOrEqual(2);

    await panel.locator("button", { hasText: /\[diag\]/ }).click();
    await expect(
      panel.locator('[data-diag-event][data-diag-kind="exception"]'),
    ).toContainText("uncaught-XYZ");
    await expect(
      panel.locator('[data-diag-event][data-diag-kind="unhandledrejection"]'),
    ).toContainText("rejected-XYZ");
  });
});
