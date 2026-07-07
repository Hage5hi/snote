// Verifies that when the debug panel dedupes `snote:pwa-readiness-invalid`
// emissions across an unchanged malformed readiness cycle, the single
// emitted payload is the FIRST-invalid detail (fail-fast on the first
// failing field), not a later mutation or the last field checked.
import { test, expect } from "@playwright/test";

test("dedup preserves first-invalid payload detail for the cycle", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as { __captured?: unknown[] }).__captured = [];
    window.addEventListener("snote:pwa-readiness-invalid", (e) => {
      (window as unknown as { __captured: unknown[] }).__captured.push((e as CustomEvent).detail);
    });
    // currentBuildId is the FIRST field evaluated → its failure must win,
    // even though reloadStrategy is also invalid.
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "",
      pendingBuildId: null,
      updateAvailable: false,
      updateInProgress: false,
      reloadAttemptCount: 0,
      reloadStrategy: "teleport",
      lastRemoteBuildId: null,
      lastAcceptedAt: null,
    };
  });

  await expect
    .poll(
      async () =>
        await page.evaluate(() => (window as unknown as { __captured: unknown[] }).__captured.length),
      { timeout: 4000 },
    )
    .toBe(1);

  // Give several more poll ticks — dedupe must keep it at exactly 1.
  await page.waitForTimeout(2000);
  const captured = await page.evaluate(
    () => (window as unknown as { __captured: unknown[] }).__captured,
  );
  expect(captured.length).toBe(1);
  expect(captured[0]).toMatchObject({
    field: "currentBuildId",
    path: "currentBuildId",
    received: "string",
  });
});
