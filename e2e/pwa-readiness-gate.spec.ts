// E2E: the PWA readiness gate blocks the update flow until the app is
// ready (poller populated __SNOTE_PWA_UPDATE_STATE__), and only then
// does the DEV-only debug panel render its state rows.
import { test, expect } from "@playwright/test";

test("readiness gate: panel stays empty until state is populated, then renders", async ({ page }) => {
  // Do NOT prime state — gate should keep the panel unmounted.
  await page.goto("/");

  const panel = page.locator("[data-pwa-debug-panel='true']");
  await expect(panel).toHaveCount(0);

  // Simulate the poller becoming ready.
  await page.evaluate(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-ready-1",
      pendingBuildId: "build-ready-2",
      updateAvailable: true,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: "hard",
      lastRemoteBuildId: "build-ready-2",
    };
  });

  // Panel polls every 500ms.
  await expect(panel).toBeVisible({ timeout: 3_000 });
  await panel.getByRole("button").click();
  await expect(panel).toContainText(/last remote:\s*build-ready-2/);
});
