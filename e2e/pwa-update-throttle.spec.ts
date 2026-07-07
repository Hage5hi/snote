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

async function attach(testInfo: TestInfo, page: Page, label: string) {
  const state = await pwaState(page).catch((error) => ({ error: String(error) }));
  await testInfo.attach(`pwa-update-throttle-${label}.json`, {
    body: JSON.stringify({ state }, null, 2),
    contentType: "application/json",
  });
}

// On failure, attach a full-page screenshot + serialized toast DOM so the
// exact UI state at the flicker assertion is debuggable without opening the
// trace viewer. Playwright config also retains trace/video on failure.
let currentPageForHook: Page | null = null;
test.afterEach(async ({}, testInfo) => {
  const page = currentPageForHook;
  currentPageForHook = null;
  if (!page || testInfo.status === testInfo.expectedStatus) return;
  try {
    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach("pwa-update-throttle-failure.png", { body: shot, contentType: "image/png" });
    const toastHtml = await page.locator("[data-sonner-toast]").first()
      .evaluate((n) => (n as HTMLElement).outerHTML).catch(() => "<no toast>");
    await testInfo.attach("pwa-update-throttle-failure-toast.html", { body: toastHtml, contentType: "text/html" });
  } catch { /* best-effort */ }
});

test("Repeated Update clicks only fire one reload and toast never flickers back", async ({ page }, testInfo) => {
  test.setTimeout(20_000);
  currentPageForHook = page;
  // Hold the hard reload so we can rapid-fire click while the update is 'in-flight'.
  const version = { buildId: "build-v2" };
  await page.addInitScript(() => {
    (window as any).__SNOTE_E2E_ENABLE_PWA_UPDATE__ = true;
    (window as any).__SNOTE_E2E_BUILD_ID__ = "build-v1";
    (window as any).__SNOTE_E2E_PWA_INITIAL_POLL_MS__ = 10;
    (window as any).__SNOTE_E2E_PWA_POLL_INTERVAL_MS__ = 250;
    // Intercept the E2E hard-reload event and defer applying the new buildId
    // so we can spam Update clicks while a reload is 'in progress'.
    (window as any).__SNOTE_E2E_HELD_TARGET__ = null;
    window.addEventListener("snote:e2e-pwa-hard-reload", (e: Event) => {
      const detail = (e as CustomEvent).detail as { targetBuildId: string };
      // Undo the immediate buildId swap so the toast stays in 'pending'.
      (window as any).__SNOTE_E2E_BUILD_ID__ = "build-v1";
      (window as any).__SNOTE_E2E_HELD_TARGET__ = detail.targetBuildId;
    });
  });
  await page.route("**/version.json**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(version) });
  });

  await page.goto("/");
  const toast = page.getByText("New version available");
  await expect(toast).toBeVisible({ timeout: 5_000 });
  await attach(testInfo, page, "before-click");

  const update = page.getByRole("button", { name: /^Update$/ });
  await update.click();

  // Spam clicks while the reload is 'in flight'.
  const pending = page.getByRole("button", { name: /^Update…$/ });
  await expect(pending).toBeDisabled();
  for (let i = 0; i < 8; i++) {
    await pending.click({ force: true }).catch(() => {});
  }
  await expect(page.getByText("Update pending")).toBeVisible();
  await attach(testInfo, page, "while-pending");

  // Only one reload attempt should have been recorded.
  const midState = await pwaState(page);
  expect(midState?.reloadAttemptCount).toBe(1);
  expect(midState?.updateInProgress).toBe(true);

  // Toast must NOT flip back to "New version available" while pending.
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(200);
    const flickered = await page.getByText("New version available").count();
    expect(flickered, `flicker detected on iteration ${i}`).toBe(0);
  }

  // Now release the held reload → buildId transitions → toast auto-hides.
  await page.evaluate(() => {
    const target = (window as any).__SNOTE_E2E_HELD_TARGET__;
    if (target) (window as any).__SNOTE_E2E_BUILD_ID__ = target;
  });

  await expect(toast).toBeHidden({ timeout: 5_000 });
  await expect(page.getByText("Update pending")).toBeHidden();
  const finalState = await pwaState(page);
  expect(finalState?.reloadAttemptCount).toBe(1);
  expect(finalState?.currentBuildId).toBe("build-v2");
  expect(finalState?.updateInProgress).toBe(false);
  expect(finalState?.updateAvailable).toBe(false);
  await attach(testInfo, page, "after-transition");
});
