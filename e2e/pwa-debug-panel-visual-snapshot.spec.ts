// E2E: snapshot the PwaUpdateDebugPanel to confirm it renders the expected
// fields under a valid readiness state and is entirely absent under
// malformed state. Uses DOM text snapshots (not pixel diffs) for stability.
import { test, expect } from "@playwright/test";

test("debug panel DOM snapshot: valid state renders fields", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = {
      currentBuildId: "build-current-snap",
      pendingBuildId: "build-pending-snap",
      updateAvailable: true,
      updateInProgress: false,
      reloadAttemptCount: 3,
      reloadStrategy: "waiting-sw",
      lastRemoteBuildId: "build-pending-snap",
    };
  });
  await page.goto("/");
  const panel = page.locator("[data-pwa-debug-panel='true']");
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await panel.getByRole("button").click();

  const text = (await panel.innerText()).replace(/\s+/g, " ").trim();
  expect(text).toContain("current: build-current-snap");
  expect(text).toContain("pending: build-pending-snap");
  expect(text).toContain("strategy: waiting-sw");
  expect(text).toContain("attempts: 3");
  expect(text).toContain("last remote: build-pending-snap");
  expect(text).toContain("inProgress: false");
});

test("debug panel DOM snapshot: malformed state → panel absent from DOM", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__ = [] as never;
  });
  await page.goto("/");
  await page.waitForTimeout(1_200);
  await expect(page.locator("[data-pwa-debug-panel='true']")).toHaveCount(0);
});
