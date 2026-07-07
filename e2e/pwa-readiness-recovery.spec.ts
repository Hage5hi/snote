// E2E: readiness gate recovery. Panel must stay unmounted while state is
// malformed, then mount as soon as a valid state object appears — proving
// the gate is not latched by an early bad value.
import { test, expect } from "@playwright/test";

test("panel stays hidden for malformed state, then renders after valid state arrives", async ({ page }) => {
  await page.addInitScript(() => {
    // Start malformed (falsy → gate closed).
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = null;
  });
  await page.goto("/");

  const panel = page.locator("[data-pwa-debug-panel='true']");
  await page.waitForTimeout(1_200);
  await expect(panel).toHaveCount(0);

  // Flip to a valid state — poller (500ms) should pick it up.
  await page.evaluate(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-recover-1",
      pendingBuildId: "build-recover-2",
      updateAvailable: true,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: "hard",
      lastRemoteBuildId: "build-recover-2",
    };
  });

  await expect(panel).toBeVisible({ timeout: 3_000 });
  await panel.getByRole("button").click();
  await expect(panel).toContainText(/current:\s*build-recover-1/);
  await expect(panel).toContainText(/pending:\s*build-recover-2/);

  // And back to malformed → panel unmounts again.
  await page.evaluate(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = undefined;
  });
  await expect(panel).toHaveCount(0, { timeout: 3_000 });
});
