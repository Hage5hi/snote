// Asserts that the `snote:pwa-readiness-invalid` CustomEvent is emitted with
// the correct `detail` shape whenever the PwaUpdateDebugPanel encounters a
// malformed readiness state on window.__SNOTE_PWA_UPDATE_STATE__.
import { test, expect } from "@playwright/test";

test.describe("snote:pwa-readiness-invalid emission", () => {
  test("emits {field, path, reason, received} on malformed state", async ({ page }) => {
    await page.goto("/");

    // Install listener BEFORE we mutate state so the interval read (500ms)
    // catches it and the panel's read() dispatches the event.
    await page.evaluate(() => {
      (window as unknown as { __captured?: unknown[] }).__captured = [];
      window.addEventListener("snote:pwa-readiness-invalid", (e) => {
        (window as unknown as { __captured: unknown[] }).__captured.push(
          (e as CustomEvent).detail,
        );
      });
    });

    // Assign a malformed readiness state (reloadStrategy is not in the allowed set).
    await page.evaluate(() => {
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

    await expect
      .poll(async () => await page.evaluate(() => (window as unknown as { __captured: unknown[] }).__captured.length), {
        timeout: 4000,
      })
      .toBeGreaterThan(0);

    const first = await page.evaluate(
      () => (window as unknown as { __captured: unknown[] }).__captured[0],
    );
    expect(first).toMatchObject({
      field: "reloadStrategy",
      path: "reloadStrategy",
      received: "teleport",
    });
    expect(typeof (first as { reason: string }).reason).toBe("string");
  });
});
