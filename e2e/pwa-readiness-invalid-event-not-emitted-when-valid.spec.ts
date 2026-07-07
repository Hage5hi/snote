// E2E: when readiness state is fully valid, the debug panel must NOT emit
// `snote:pwa-readiness-invalid`.
import { test, expect } from "@playwright/test";

test("no snote:pwa-readiness-invalid when readiness state is valid", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    (window as unknown as { __captured?: unknown[] }).__captured = [];
    window.addEventListener("snote:pwa-readiness-invalid", (e) => {
      (window as unknown as { __captured: unknown[] }).__captured.push(
        (e as CustomEvent).detail,
      );
    });
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-valid",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: null,
      lastRemoteBuildId: null,
      lastAcceptedAt: null,
    };
  });

  // Wait long enough for several panel read() ticks (500ms interval).
  await page.waitForTimeout(2000);

  const count = await page.evaluate(
    () => (window as unknown as { __captured: unknown[] }).__captured.length,
  );
  expect(count).toBe(0);
});
