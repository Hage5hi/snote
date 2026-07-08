// E2E: reload the page and verify the invalid-events frequency stats are
// restored from sessionStorage (short-lived persistence).
import { test, expect } from "@playwright/test";

test("Invalid-events stats restore from sessionStorage after reload", async ({ page }) => {
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
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(
        new CustomEvent("snote:pwa-readiness-invalid", {
          detail: { field: "reloadStrategy", path: "reloadStrategy", reason: "invalid", received: "x" },
        }),
      );
    }
  });

  const stats = page.locator("[data-pwa-debug-stats='invalid-events']");
  await expect(stats).toHaveAttribute("data-invalid-total", "3", { timeout: 3_000 });

  // Ensure the panel has flushed the snapshot to sessionStorage.
  await expect
    .poll(async () =>
      page.evaluate(() => window.sessionStorage.getItem("snote:pwa-invalid-stats:v1")),
    )
    .not.toBeNull();

  await page.reload();
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await panel.getByRole("button").first().click();
  const stats2 = page.locator("[data-pwa-debug-stats='invalid-events']");
  await expect(stats2).toHaveAttribute("data-invalid-total", "3", { timeout: 5_000 });
});
