// E2E: PwaUpdateDebugPanel must stay unmounted while readiness state is
// malformed and only mount (with the expected fields) once the state is
// corrected into a valid object. Covers the malformed → valid transition
// that the standalone malformed spec doesn't exercise.
import { test, expect } from "@playwright/test";

const malformedValues: Array<{ label: string; value: unknown }> = [
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: "empty-string", value: "" },
  { label: "empty-array", value: [] },
];

for (const { label, value } of malformedValues) {
  test(`panel unmount while malformed (${label}), then mounts after fix`, async ({ page }) => {
    await page.addInitScript((v) => {
      (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = v as never;
    }, value);
    await page.goto("/");

    const panel = page.locator("[data-pwa-debug-panel='true']");
    // Give the 500ms poller several ticks — panel must not appear.
    await page.waitForTimeout(1_200);
    await expect(panel).toHaveCount(0);

    // Fix the state → panel mounts with expected fields.
    await page.evaluate(() => {
      (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
        currentBuildId: "build-fixed-1",
        pendingBuildId: "build-fixed-2",
        updateAvailable: true,
        updateInProgress: false,
        reloadAttemptCount: 0,
        reloadStrategy: "hard",
        lastRemoteBuildId: "build-fixed-2",
      };
    });
    await expect(panel).toHaveCount(1, { timeout: 3_000 });
    await expect(panel).toBeVisible();
    await panel.getByRole("button").click();
    await expect(panel).toContainText(/current:\s*build-fixed-1/);
    await expect(panel).toContainText(/pending:\s*build-fixed-2/);
    await expect(panel).toContainText(/strategy:\s*hard/);
    await expect(panel).toContainText(/attempts:\s*0/);
    await expect(panel).toContainText(/last remote:\s*build-fixed-2/);

    // Regress back to malformed → panel unmounts again.
    await page.evaluate(() => {
      (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = null as never;
    });
    await expect(panel).toHaveCount(0, { timeout: 3_000 });
  });
}
