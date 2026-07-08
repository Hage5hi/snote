// E2E: verify that remounting/navigating the DEV debug panel does not
// cause duplicate listeners to double-count `snote:pwa-readiness-invalid`
// events. The module-level ref-counted listener + sessionStorage
// persistence should keep the total exactly equal to the number of
// dispatched events across reloads.
import { test, expect } from "@playwright/test";

test("invalid-events total is not inflated by panel remounts / reloads", async ({ page }) => {
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
  });

  await page.goto("/");
  const panel = page.locator("[data-pwa-debug-panel='true']");
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await panel.getByRole("button").first().click(); // expand to reveal stats block

  const dispatch = async (n: number) => {
    await page.evaluate((count) => {
      for (let i = 0; i < count; i++) {
        window.dispatchEvent(
          new CustomEvent("snote:pwa-readiness-invalid", {
            detail: { field: "reloadStrategy", path: "reloadStrategy", reason: "invalid", received: "x" },
          }),
        );
      }
    }, n);
  };

  await dispatch(3);
  const statsBlock = page.locator("[data-pwa-debug-stats='invalid-events']");
  await expect(statsBlock).toHaveAttribute("data-invalid-total", "3", { timeout: 3_000 });

  // Reload — panel unmounts + remounts, listener must reattach exactly once
  // and previously-counted events should be restored from sessionStorage.
  await page.reload();
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await panel.getByRole("button").first().click();
  await expect(page.locator("[data-pwa-debug-stats='invalid-events']")).toHaveAttribute(
    "data-invalid-total",
    "3",
    { timeout: 3_000 },
  );

  // Dispatch 3 more — total must be exactly 6, not 9 (would happen if a
  // duplicate listener were attached).
  await dispatch(3);
  await expect(page.locator("[data-pwa-debug-stats='invalid-events']")).toHaveAttribute(
    "data-invalid-total",
    "6",
    { timeout: 3_000 },
  );
});
