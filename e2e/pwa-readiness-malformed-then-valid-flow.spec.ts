// E2E: once a malformed readiness state is corrected into a valid one,
// the full PWA update flow proceeds — reload strategy is applied and the
// attempt counter advances through the applied state.
import { test, expect } from "@playwright/test";

test("malformed → valid readiness → full update flow with strategy applied", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = "not-an-object" as never;
  });
  await page.goto("/");

  const panel = page.locator("[data-pwa-debug-panel='true']");
  await page.waitForTimeout(1_000);
  await expect(panel).toHaveCount(0);

  // Fix into a valid, "update available" state.
  await page.evaluate(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-A",
      pendingBuildId: "build-B",
      updateAvailable: true,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: "hard",
      lastRemoteBuildId: "build-B",
    };
  });
  await expect(panel).toBeVisible({ timeout: 3_000 });
  await panel.getByRole("button").click();
  await expect(panel).toContainText(/pending:\s*build-B/);

  // Accept → in-progress, attempt bumped.
  await page.evaluate(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-A",
      pendingBuildId: "build-B",
      updateAvailable: true,
      updateInProgress: true,
      reloadAttemptCount: 1,
      reloadStrategy: "hard",
      lastRemoteBuildId: "build-B",
    };
  });
  await expect(panel).toContainText(/inProgress:\s*true/, { timeout: 3_000 });
  await expect(panel).toContainText(/attempts:\s*1/);
  await expect(panel).toContainText(/strategy:\s*hard/);

  // Applied: current advances, pending clears, strategy retained.
  await page.evaluate(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-B",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 1,
      reloadStrategy: "hard",
      lastRemoteBuildId: "build-B",
    };
  });
  await expect(panel).toContainText(/current:\s*build-B/, { timeout: 3_000 });
  await expect(panel).toContainText(/pending:\s*—/);
  await expect(panel).toContainText(/inProgress:\s*false/);
  await expect(panel).toContainText(/strategy:\s*hard/);
  await expect(panel).toContainText(/attempts:\s*1/);
});
