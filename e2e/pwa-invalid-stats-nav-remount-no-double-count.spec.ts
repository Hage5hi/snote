// E2E: navigate between routes (including Split view) and verify that
// remounting the DEV debug panel does not inflate invalid-events counts
// due to duplicate `snote:pwa-readiness-invalid` listeners.
import { test, expect } from "@playwright/test";

test("navigating across routes does not double-count invalid events", async ({ page }) => {
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

  const dispatch = (n: number) =>
    page.evaluate((count) => {
      for (let i = 0; i < count; i++) {
        window.dispatchEvent(
          new CustomEvent("snote:pwa-readiness-invalid", {
            detail: { field: "reloadStrategy", path: "reloadStrategy", reason: "invalid", received: "x" },
          }),
        );
      }
    }, n);

  await page.goto("/");
  const panel = page.locator("[data-pwa-debug-panel='true']");
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await panel.getByRole("button").first().click();
  await dispatch(2);
  await expect(page.locator("[data-pwa-debug-stats='invalid-events']")).toHaveAttribute(
    "data-invalid-total",
    "2",
    { timeout: 3_000 },
  );

  // Navigate to a Split view route — the panel unmounts and remounts.
  await page.goto("/a+b");
  await expect(page.locator("[data-pwa-debug-panel='true']")).toBeVisible({ timeout: 5_000 });
  await page.locator("[data-pwa-debug-panel='true']").getByRole("button").first().click();
  await dispatch(2);
  await expect(page.locator("[data-pwa-debug-stats='invalid-events']")).toHaveAttribute(
    "data-invalid-total",
    "4",
    { timeout: 3_000 },
  );

  // Back to home again — still exactly cumulative, no duplicate listeners.
  await page.goto("/");
  await expect(page.locator("[data-pwa-debug-panel='true']")).toBeVisible({ timeout: 5_000 });
  await page.locator("[data-pwa-debug-panel='true']").getByRole("button").first().click();
  await dispatch(1);
  await expect(page.locator("[data-pwa-debug-stats='invalid-events']")).toHaveAttribute(
    "data-invalid-total",
    "5",
    { timeout: 3_000 },
  );
});
