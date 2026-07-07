// E2E: oscillate readiness state malformed ↔ valid several times.
// Panel must unmount/mount correctly each cycle and console must remain
// error-free.
import { test, expect, type ConsoleMessage } from "@playwright/test";

test("malformed → valid oscillation: panel toggles cleanly, no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.addInitScript(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = null as never;
  });
  await page.goto("/");

  const panel = page.locator("[data-pwa-debug-panel='true']");
  const validState = {
    currentBuildId: "build-x",
    pendingBuildId: "build-y",
    updateAvailable: true,
    updateInProgress: false,
    reloadAttemptCount: 0,
    reloadStrategy: "hard" as const,
    lastRemoteBuildId: "build-y",
  };

  for (let i = 0; i < 3; i++) {
    // Malformed
    await page.evaluate(() => {
      (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = null as never;
    });
    await expect(panel).toHaveCount(0, { timeout: 3_000 });

    // Valid
    await page.evaluate((s) => {
      (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = s;
    }, validState);
    await expect(panel).toHaveCount(1, { timeout: 3_000 });
  }

  expect(errors, `unexpected console errors during oscillation:\n${errors.join("\n")}`).toEqual([]);
});
