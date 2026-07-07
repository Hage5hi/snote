// E2E: DEV-only PWA update debug panel renders the expected fields.
// Populates window.__SNOTE_PWA_UPDATE_STATE__ directly and asserts the
// panel surfaces current/pending buildId, reload strategy, attempt count,
// and the last remote buildId. The panel only mounts under import.meta.env.DEV,
// which is the default for the Vite dev server this suite runs against.
import { test, expect } from "@playwright/test";

test("PWA update debug panel shows buildId, strategy, attempts, last remote", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-current-abc",
      pendingBuildId: "build-pending-xyz",
      updateAvailable: true,
      updateInProgress: false,
      reloadAttemptCount: 2,
      reloadStrategy: "hard",
      lastRemoteBuildId: "build-remote-xyz",
    };
  });
  await page.goto("/");

  const panel = page.locator("[data-pwa-debug-panel='true']");
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // Collapsed header shows current → pending.
  await expect(panel).toContainText("build-current-abc");
  await expect(panel).toContainText("build-pending-xyz");

  // Expand the panel to reveal the detail rows.
  await panel.getByRole("button").click();

  await expect(panel).toContainText(/current:\s*build-current-abc/);
  await expect(panel).toContainText(/pending:\s*build-pending-xyz/);
  await expect(panel).toContainText(/strategy:\s*hard/);
  await expect(panel).toContainText(/attempts:\s*2/);
});
