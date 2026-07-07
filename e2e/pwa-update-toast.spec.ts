import { expect, test, type Page, type TestInfo } from "@playwright/test";

type PwaUpdateState = {
  currentBuildId: string;
  pendingBuildId: string | null;
  updateAvailable: boolean;
  updateInProgress: boolean;
  lastRemoteBuildId: string | null;
  reloadAttemptCount: number;
  reloadStrategy: "waiting-sw" | "hard" | null;
  lastAcceptedAt: number | null;
};

async function pwaState(page: Page): Promise<PwaUpdateState | null> {
  return page.evaluate(() => (window as any).__SNOTE_PWA_UPDATE_STATE__ ?? null);
}

async function attachPwaMetadata(testInfo: TestInfo, page: Page, label: string) {
  const state = await pwaState(page).catch((error) => ({ error: String(error) }));
  const toastLocator = page.locator("[data-sonner-toast]");
  const toastText = (await toastLocator.count())
    ? await toastLocator.first().evaluate((node) => (node as HTMLElement).innerText).catch(() => null)
    : null;
  await testInfo.attach(`pwa-update-${label}.json`, {
    body: JSON.stringify({ state, toastText }, null, 2),
    contentType: "application/json",
  });
}

test("Update toast disappears only after the running buildId changes", async ({ page }, testInfo) => {
  test.setTimeout(15_000);
  const version = { buildId: "build-v2" };
  const consoleLines: string[] = [];
  const versionRequests: string[] = [];
  page.on("console", (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.name}: ${error.message}`));

  await page.addInitScript(() => {
    (window as any).__SNOTE_E2E_ENABLE_PWA_UPDATE__ = true;
    (window as any).__SNOTE_E2E_BUILD_ID__ = "build-v1";
    (window as any).__SNOTE_E2E_PWA_INITIAL_POLL_MS__ = 10;
    (window as any).__SNOTE_E2E_PWA_POLL_INTERVAL_MS__ = 1000;
  });
  await page.route("**/version.json**", async (route) => {
    versionRequests.push(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(version),
    });
  });

  await page.goto("/");
  await expect.poll(async () => page.evaluate(() => (window as any).__SNOTE_E2E_ENABLE_PWA_UPDATE__)).toBe(true);
  await testInfo.attach("pwa-update-console.log", {
    body: JSON.stringify({ consoleLines, versionRequests, state: await pwaState(page) }, null, 2),
    contentType: "text/plain",
  });

  const toast = page.getByText("New version available");
  await expect(toast).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Current: build-v1")).toBeVisible();
  await expect(page.getByText("Pending: build-v2")).toBeVisible();
  await attachPwaMetadata(testInfo, page, "before-click");

  const update = page.getByRole("button", { name: /^Update$/ });
  await update.click();

  const disabledUpdate = page.getByRole("button", { name: /^Update…$/ });
  await expect(disabledUpdate).toBeDisabled();
  await expect.poll(async () => (await pwaState(page))?.reloadAttemptCount).toBe(1);
  await attachPwaMetadata(testInfo, page, "after-click");

  await expect(toast).toBeHidden({ timeout: 5_000 });
  await expect.poll(async () => (await pwaState(page))?.currentBuildId).toBe("build-v2");
  await expect.poll(async () => (await pwaState(page))?.pendingBuildId).toBeNull();
  await expect.poll(async () => (await pwaState(page))?.updateAvailable).toBe(false);
  await expect.poll(async () => (await pwaState(page))?.updateInProgress).toBe(false);
  await expect.poll(async () => (await pwaState(page))?.reloadAttemptCount).toBe(1);
  await expect.poll(async () => (await pwaState(page))?.reloadStrategy).toBe("hard");
  await attachPwaMetadata(testInfo, page, "after-new-build");
});