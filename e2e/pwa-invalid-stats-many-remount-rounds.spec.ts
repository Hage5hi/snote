// E2E: navigate + collapse/expand the PWA debug panel repeatedly across
// routes to force many mount/unmount cycles. The invalid-events frequency
// must equal exactly the number of dispatched events — no double-count
// from duplicate listeners.
import { test, expect } from "@playwright/test";

test("many remount rounds keep invalid-events count exact (no duplicate listeners)", async ({ page }) => {
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

  const expand = async () => {
    const panel = page.locator("[data-pwa-debug-panel='true']");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await panel.getByRole("button").first().click();
  };

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

  const routes = ["/", "/a+b", "/", "/a+b+c", "/", "/a+b+c+d", "/"];
  let expected = 0;
  for (let round = 0; round < routes.length; round++) {
    await page.goto(routes[round]);
    await expand();
    // Toggle collapse/expand a few times to force effect re-runs.
    const toggleBtn = page.locator("[data-pwa-debug-panel='true']").getByRole("button").first();
    await toggleBtn.click();
    await toggleBtn.click();
    await dispatch(1);
    expected += 1;
    await expect(page.locator("[data-pwa-debug-stats='invalid-events']")).toHaveAttribute(
      "data-invalid-total",
      String(expected),
      { timeout: 3_000 },
    );
  }

  // Final assertion — exact cumulative count, not a multiple.
  await expect(page.locator("[data-pwa-debug-stats='invalid-events']")).toHaveAttribute(
    "data-invalid-total",
    String(routes.length),
  );
});
