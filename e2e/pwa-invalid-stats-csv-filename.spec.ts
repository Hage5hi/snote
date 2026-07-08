// E2E: CSV export filename must include the currently-selected time
// range so users can distinguish exports taken at different windows.
import { test, expect } from "@playwright/test";

for (const window of ["5m", "1h", "24h"] as const) {
  test(`CSV export filename includes selected window (${window})`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
        currentBuildId: "build-a",
        pendingBuildId: null,
        updateAvailable: false,
        updateInProgress: false,
        reloadAttemptCount: 0,
        reloadStrategy: null,
        lastRemoteBuildId: "build-a",
      };
      try {
        sessionStorage.removeItem("snote:pwa-invalid-stats:v1");
      } catch {
        /* ignore */
      }
    });

    await page.goto("/");
    const panel = page.locator("[data-pwa-debug-panel='true']");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await panel.getByRole("button").first().click();

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("snote:pwa-readiness-invalid", {
          detail: { field: "reloadStrategy", path: "reloadStrategy", reason: "invalid", received: "x" },
        }),
      );
    });
    await expect(page.locator("[data-pwa-debug-stats='invalid-events']")).toHaveAttribute(
      "data-invalid-total",
      "1",
      { timeout: 3_000 },
    );

    await page.locator(`[data-pwa-debug-stats-window='${window}']`).click();
    await expect(page.locator("[data-pwa-debug-stats='invalid-events']")).toHaveAttribute(
      "data-invalid-window",
      window,
    );

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("[data-pwa-debug-stats-export='csv']").click(),
    ]);

    const name = download.suggestedFilename();
    expect(name).toMatch(new RegExp(`^pwa-readiness-invalid-${window}-.+\\.csv$`));
  });
}
