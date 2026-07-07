// E2E: after readiness state transitions from malformed → valid with
// reloadStrategy="waiting-sw" (soft), the debug panel surfaces that
// strategy correctly. Also covers the "hard" variant for parity.
import { test, expect } from "@playwright/test";

const strategies: Array<"waiting-sw" | "hard"> = ["waiting-sw", "hard"];

for (const strategy of strategies) {
  test(`panel reflects reloadStrategy=${strategy} after malformed → valid`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = null as never;
    });
    await page.goto("/");

    const panel = page.locator("[data-pwa-debug-panel='true']");
    await page.waitForTimeout(800);
    await expect(panel).toHaveCount(0);

    await page.evaluate((s) => {
      (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
        currentBuildId: "build-a",
        pendingBuildId: "build-b",
        updateAvailable: true,
        updateInProgress: true,
        reloadAttemptCount: 1,
        reloadStrategy: s,
        lastRemoteBuildId: "build-b",
      };
    }, strategy);

    await expect(panel).toHaveCount(1, { timeout: 3_000 });
    await panel.getByRole("button").click();
    await expect(panel).toContainText(new RegExp(`strategy:\\s*${strategy}`));
    await expect(panel).toContainText(/attempts:\s*1/);
    await expect(panel).toContainText(/inProgress:\s*true/);
  });
}
