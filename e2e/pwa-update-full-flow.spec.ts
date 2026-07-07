// E2E: full PWA update flow — readiness gate unblocks, debug panel picks up
// state transitions, and the reload strategy the app applied is reflected.
//
// We drive window.__SNOTE_PWA_UPDATE_STATE__ directly (the panel polls it
// every 500ms) rather than the real service worker so the spec is
// deterministic across browsers.
import { test, expect } from "@playwright/test";

test("PWA update flow: gate → available → in-progress → applied", async ({ page }) => {
  await page.goto("/");
  const panel = page.locator("[data-pwa-debug-panel='true']");

  // 1) Readiness gate: no state → panel is not mounted.
  await expect(panel).toHaveCount(0);

  // 2) Poller becomes ready but no update yet.
  await page.evaluate(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-1",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: null,
      lastRemoteBuildId: "build-1",
    };
  });
  await expect(panel).toBeVisible({ timeout: 3_000 });
  await panel.getByRole("button").click();
  await expect(panel).toContainText(/pending:\s*—/);
  await expect(panel).toContainText(/strategy:\s*—/);
  await expect(panel).toContainText(/attempts:\s*0/);

  // 3) Remote publishes build-2 → update becomes available.
  await page.evaluate(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      updateAvailable: true,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: "hard",
      lastRemoteBuildId: "build-2",
    };
  });
  await expect(panel).toContainText(/pending:\s*build-2/, { timeout: 3_000 });
  await expect(panel).toContainText(/strategy:\s*hard/);
  await expect(panel).toContainText(/last remote:\s*build-2/);

  // 4) User accepts → in-progress with attempt count bumped.
  await page.evaluate(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      updateAvailable: true,
      updateInProgress: true,
      reloadAttemptCount: 1,
      reloadStrategy: "hard",
      lastRemoteBuildId: "build-2",
    };
  });
  await expect(panel).toContainText(/inProgress:\s*true/, { timeout: 3_000 });
  await expect(panel).toContainText(/attempts:\s*1/);

  // 5) After hard reload the strategy is applied: current == build-2, cleared.
  await page.evaluate(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-2",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 1,
      reloadStrategy: "hard",
      lastRemoteBuildId: "build-2",
    };
  });
  await expect(panel).toContainText(/current:\s*build-2/, { timeout: 3_000 });
  await expect(panel).toContainText(/pending:\s*—/);
  await expect(panel).toContainText(/inProgress:\s*false/);
});
