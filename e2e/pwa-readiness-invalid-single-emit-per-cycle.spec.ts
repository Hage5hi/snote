// Verifies `snote:pwa-readiness-invalid` is emitted once per readiness
// update cycle: even though the debug panel polls every 500ms, an unchanged
// malformed state must not spam listeners. Changing the state to a NEW
// invalid signature emits again.
import { test, expect } from "@playwright/test";

test("dedupes emission per unchanged malformed readiness state", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as { __captured?: unknown[] }).__captured = [];
    window.addEventListener("snote:pwa-readiness-invalid", (e) => {
      (window as unknown as { __captured: unknown[] }).__captured.push((e as CustomEvent).detail);
    });
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "b1",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: "teleport",
      lastRemoteBuildId: null,
      lastAcceptedAt: null,
    };
  });

  // Give the panel several poll ticks (>= 500ms * 4).
  await page.waitForTimeout(2500);
  const count1 = await page.evaluate(
    () => (window as unknown as { __captured: unknown[] }).__captured.length,
  );
  expect(count1).toBe(1);

  // Change to a different invalid signature — should emit exactly one more.
  await page.evaluate(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: null,
      lastRemoteBuildId: null,
      lastAcceptedAt: null,
    };
  });
  await expect
    .poll(async () =>
      await page.evaluate(() => (window as unknown as { __captured: unknown[] }).__captured.length),
    { timeout: 3000 })
    .toBe(2);

  await page.waitForTimeout(1500);
  const count3 = await page.evaluate(
    () => (window as unknown as { __captured: unknown[] }).__captured.length,
  );
  expect(count3).toBe(2);
});
