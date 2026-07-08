// E2E: clicking Update multiple times only triggers one reload path and the
// note URL never gains a ?v= cache-buster, even under rapid repeated clicks.
import { expect, test } from "@playwright/test";
import { getHardReloadCount, installPwaUpdateMock, waitForPwaUpdaterReady } from "./helpers/pwa-update-mock";

test("multiple Update clicks apply the new build without adding ?v to the URL", async ({ page }, testInfo) => {
  // Record every URL the page navigates to so a `?v=` regression is easy to
  // trace back to the exact click that introduced it (attached below).
  const urlHistory: Array<{ at: number; url: string; type: "goto" | "framenavigated" }> = [];
  const t0 = Date.now();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      urlHistory.push({ at: Date.now() - t0, url: frame.url(), type: "framenavigated" });
    }
  });

  await installPwaUpdateMock(page, {
    fromBuildId: "build-multi-v1",
    toBuildId: "build-multi-v2",
  });

  urlHistory.push({ at: Date.now() - t0, url: "/my-note?foo=bar", type: "goto" });
  await page.goto("/my-note?foo=bar");
  await waitForPwaUpdaterReady(page, testInfo);

  const toast = page.getByText("New version available");
  await expect(toast).toBeVisible({ timeout: 5_000 });

  const update = page.getByRole("button", { name: /^Update$/ });
  await update.click();
  // Rapid follow-up clicks should be ignored (button becomes "Update…").
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: /^Update(…)?$/ }).click({ force: true }).catch(() => {});
  }

  await expect.poll(() => getHardReloadCount(page)).toBe(1);
  await expect(toast).toBeHidden({ timeout: 5_000 });

  const url = new URL(page.url());
  const hasVParam = url.searchParams.has("v");

  // On regression: attach URL history + a screenshot BEFORE the assertion
  // fails, so post-deploy smoke runs surface the offending navigation
  // without needing to re-run with tracing.
  if (hasVParam || url.pathname !== "/my-note" || url.searchParams.get("foo") !== "bar") {
    await testInfo.attach("url-history.json", {
      body: JSON.stringify({ finalUrl: page.url(), history: urlHistory }, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("regression-screenshot.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    console.error("[pwa-smoke] regression detected", { finalUrl: page.url(), urlHistory });
  }

  expect(url.pathname).toBe("/my-note");
  expect(url.searchParams.get("foo")).toBe("bar");
  expect(hasVParam, `note URL gained ?v= after Update clicks: ${page.url()}`).toBe(false);
});
