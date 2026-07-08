// E2E: clicks the CSV export button in the DEV debug panel stats block
// and asserts the downloaded CSV contains the expected headers and
// bucket values for the selected time range.
import { test, expect } from "@playwright/test";

test("CSV export contains expected headers and bucket values for selected range", async ({ page }) => {
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
    // Clear any persisted stats from previous runs so counts are deterministic.
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

  // Dispatch 4 invalid events.
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      window.dispatchEvent(
        new CustomEvent("snote:pwa-readiness-invalid", {
          detail: { field: "reloadStrategy", path: "reloadStrategy", reason: "invalid", received: "x" },
        }),
      );
    }
  });

  const statsBlock = page.locator("[data-pwa-debug-stats='invalid-events']");
  await expect(statsBlock).toHaveAttribute("data-invalid-total", "4", { timeout: 3_000 });

  // Switch window to 5m to make windowCount deterministic for freshly-dispatched events.
  await page.locator("[data-pwa-debug-stats-window='5m']").click();
  await expect(statsBlock).toHaveAttribute("data-invalid-window", "5m");
  await expect(statsBlock).toHaveAttribute("data-invalid-window-count", "4", { timeout: 3_000 });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-pwa-debug-stats-export='csv']").click(),
  ]);

  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk as Buffer);
  const csv = Buffer.concat(chunks).toString("utf8");

  expect(csv).toContain("section,key,value");
  expect(csv).toContain("summary,total,4");
  expect(csv).toContain("summary,window,5m");
  expect(csv).toContain("summary,windowCount,4");
  expect(csv).toContain("event,index,timestampMs,timestampIso");
  // 4 event rows (index 0..3).
  for (let i = 0; i < 4; i++) {
    expect(csv).toMatch(new RegExp(`^event,${i},\\d+,`, "m"));
  }
});
