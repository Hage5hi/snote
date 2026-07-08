// E2E: clearing sessionStorage before reload must produce fresh
// invalid-events stats (total = 0) rather than restoring stale data.
import { test, expect } from "@playwright/test";

test("cleared sessionStorage yields fresh invalid-events stats after reload", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-a",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: null,
      lastRemoteBuildId: "build-a",
    };
    try {
      sessionStorage.removeItem("snote:pwa-invalid-stats:v1");
    } catch {
      /* ignore */
    }
  });

  await page.goto("/");
  const panel = page.locator("[data-pwa-debug-panel='true']");
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await panel.getByRole("button").first().click();

  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(
        new CustomEvent("snote:pwa-readiness-invalid", {
          detail: { field: "reloadStrategy", path: "reloadStrategy", reason: "invalid", received: "x" },
        }),
      );
    }
  });
  await expect(page.locator("[data-pwa-debug-stats='invalid-events']")).toHaveAttribute(
    "data-invalid-total",
    "5",
    { timeout: 3_000 },
  );

  // Clear persisted stats, then reload — must reset to 0.
  await page.evaluate(() => window.sessionStorage.removeItem("snote:pwa-invalid-stats:v1"));
  await page.reload();
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await panel.getByRole("button").first().click();
  await expect(page.locator("[data-pwa-debug-stats='invalid-events']")).toHaveAttribute(
    "data-invalid-total",
    "0",
    { timeout: 5_000 },
  );
});
