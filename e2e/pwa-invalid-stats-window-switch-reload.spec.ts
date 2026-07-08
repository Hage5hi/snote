// E2E: switch the invalid-events time-range window (5m/1h/24h) and confirm
// the stats block updates its `data-invalid-window` attribute + count, then
// reload and verify the total counts persist via sessionStorage.
import { test, expect } from "@playwright/test";

test("switching time-range updates stats and counts survive reload", async ({ page }) => {
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
    for (let i = 0; i < 4; i++) {
      window.dispatchEvent(
        new CustomEvent("snote:pwa-readiness-invalid", {
          detail: { field: "reloadStrategy", path: "reloadStrategy", reason: "invalid", received: "x" },
        }),
      );
    }
  });

  const stats = page.locator("[data-pwa-debug-stats='invalid-events']");
  await expect(stats).toHaveAttribute("data-invalid-total", "4", { timeout: 3_000 });
  await expect(stats).toHaveAttribute("data-invalid-window", "1h");
  await expect(stats).toHaveAttribute("data-invalid-window-count", "4");

  // Switch to 5m — recent events fall inside window, count preserved.
  await page.locator("[data-pwa-debug-stats-window='5m']").click();
  await expect(stats).toHaveAttribute("data-invalid-window", "5m", { timeout: 2_000 });
  await expect(stats).toHaveAttribute("data-invalid-window-count", "4");

  // Switch to 24h — still 4.
  await page.locator("[data-pwa-debug-stats-window='24h']").click();
  await expect(stats).toHaveAttribute("data-invalid-window", "24h", { timeout: 2_000 });
  await expect(stats).toHaveAttribute("data-invalid-window-count", "4");

  // Reload — totals restored from sessionStorage.
  await page.reload();
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await panel.getByRole("button").first().click();
  const stats2 = page.locator("[data-pwa-debug-stats='invalid-events']");
  await expect(stats2).toHaveAttribute("data-invalid-total", "4", { timeout: 5_000 });

  // Switching window after reload still works.
  await page.locator("[data-pwa-debug-stats-window='5m']").click();
  await expect(stats2).toHaveAttribute("data-invalid-window", "5m", { timeout: 2_000 });
  await expect(stats2).toHaveAttribute("data-invalid-window-count", "4");
});
