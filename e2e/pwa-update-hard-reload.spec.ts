import { expect, test, type Page } from "@playwright/test";
import { installPwaUpdateMock, releaseHeldReload, getHardReloadCount, waitForPwaUpdaterReady } from "./helpers/pwa-update-mock";

// Cross-browser: runs on chromium, firefox, and webkit (CI matrix).
// Forces the hard-reload path (no waiting service worker) and asserts the
// reload is attempted exactly once even under repeated clicks, and the toast
// clears after the buildId transitions.

async function pwaState(page: Page) {
  return page.evaluate(() => (window as any).__SNOTE_PWA_UPDATE_STATE__ ?? null);
}

test("Hard-reload fallback fires exactly once and toast clears", async ({ page }, testInfo) => {
  test.setTimeout(20_000);
  const debugLines: string[] = [];
  page.on("console", (msg) => {
    if (msg.text().includes("[pwa-update]")) debugLines.push(msg.text());
  });

  await installPwaUpdateMock(page, {
    fromBuildId: "build-hard-v1",
    toBuildId: "build-hard-v2",
    holdHardReload: true,
  });

  await page.goto("/");
  await waitForPwaUpdaterReady(page, testInfo);
  await expect(page.getByText("New version available")).toBeVisible({ timeout: 5_000 });

  const update = page.getByRole("button", { name: /^Update$/ });
  await update.click();
  const pending = page.getByRole("button", { name: /^Update…$/ });
  await expect(pending).toBeDisabled();

  for (let i = 0; i < 6; i++) await pending.click({ force: true }).catch(() => {});

  await expect.poll(() => getHardReloadCount(page)).toBe(1);
  const mid = await pwaState(page);
  expect(mid?.reloadStrategy).toBe("hard");
  expect(mid?.reloadAttemptCount).toBe(1);

  await releaseHeldReload(page);

  await expect(page.getByText("New version available")).toBeHidden({ timeout: 5_000 });
  await expect(page.getByText("Update pending")).toBeHidden();
  expect(await getHardReloadCount(page)).toBe(1);

  await testInfo.attach("pwa-update-hard-reload.json", {
    body: JSON.stringify({ state: await pwaState(page), debugLines }, null, 2),
    contentType: "application/json",
  });
});
