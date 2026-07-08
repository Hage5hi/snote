// E2E: after switching the invalid-events window (5m / 1h / 24h) and
// exporting CSV, verify the CSV has the correct summary window column and
// the event-row count matches the retained timestamps.
import { test, expect } from "@playwright/test";

const windows = ["5m", "1h", "24h"] as const;

for (const win of windows) {
  test(`CSV export contains correct columns and row count for window=${win}`, async ({ page }) => {
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

    const N = 3;
    await page.evaluate((count) => {
      for (let i = 0; i < count; i++) {
        window.dispatchEvent(
          new CustomEvent("snote:pwa-readiness-invalid", {
            detail: { field: "reloadStrategy", path: "reloadStrategy", reason: "invalid", received: "x" },
          }),
        );
      }
    }, N);

    await page.locator(`[data-pwa-debug-stats-window='${win}']`).click();
    const statsBlock = page.locator("[data-pwa-debug-stats='invalid-events']");
    await expect(statsBlock).toHaveAttribute("data-invalid-window", win);
    await expect(statsBlock).toHaveAttribute("data-invalid-window-count", String(N), { timeout: 3_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("[data-pwa-debug-stats-export='csv']").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`pwa-readiness-invalid-${win}-.+\\.csv`));

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream!) chunks.push(c as Buffer);
    const csv = Buffer.concat(chunks).toString("utf8");

    // Columns / summary.
    expect(csv).toContain("section,key,value");
    expect(csv).toContain(`summary,window,${win}`);
    expect(csv).toContain(`summary,windowCount,${N}`);
    expect(csv).toContain(`summary,total,${N}`);
    expect(csv).toContain("event,index,timestampMs,timestampIso");

    // Exactly N event rows (0..N-1).
    const eventRows = csv
      .split("\n")
      .filter((l) => /^event,\d+,/.test(l));
    expect(eventRows).toHaveLength(N);
  });
}
