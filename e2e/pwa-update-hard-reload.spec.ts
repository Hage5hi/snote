import { expect, test, type Page } from "@playwright/test";

// Forces the hard-reload path (no waiting service worker) and asserts the
// reload is attempted exactly once even under repeated clicks, and the toast
// clears after the buildId transitions.

async function pwaState(page: Page) {
  return page.evaluate(() => (window as any).__SNOTE_PWA_UPDATE_STATE__ ?? null);
}

test("Hard-reload fallback fires exactly once and toast clears", async ({ page }, testInfo) => {
  test.setTimeout(20_000);
  const version = { buildId: "build-hard-v2" };
  const hardReloadEvents: string[] = [];

  await page.addInitScript(() => {
    (window as any).__SNOTE_E2E_ENABLE_PWA_UPDATE__ = true;
    (window as any).__SNOTE_E2E_BUILD_ID__ = "build-hard-v1";
    (window as any).__SNOTE_E2E_PWA_INITIAL_POLL_MS__ = 10;
    (window as any).__SNOTE_E2E_PWA_POLL_INTERVAL_MS__ = 250;
    (window as any).__SNOTE_E2E_HARD_RELOAD_COUNT__ = 0;
    window.addEventListener("snote:e2e-pwa-hard-reload", (e: Event) => {
      (window as any).__SNOTE_E2E_HARD_RELOAD_COUNT__ += 1;
      // Defer applying the new buildId so the toast stays 'pending' briefly
      // and we can spam clicks without the toast auto-clearing.
      (window as any).__SNOTE_E2E_BUILD_ID__ = "build-hard-v1";
      (window as any).__SNOTE_E2E_HELD_TARGET__ = (e as CustomEvent).detail.targetBuildId;
    });
  });
  page.on("console", (msg) => {
    if (msg.text().includes("[pwa-update]")) hardReloadEvents.push(msg.text());
  });
  await page.route("**/version.json**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(version) }),
  );

  await page.goto("/");
  await expect(page.getByText("New version available")).toBeVisible({ timeout: 5_000 });

  const update = page.getByRole("button", { name: /^Update$/ });
  await update.click();
  const pending = page.getByRole("button", { name: /^Update…$/ });
  await expect(pending).toBeDisabled();

  // Spam clicks while the reload is 'in flight'.
  for (let i = 0; i < 6; i++) await pending.click({ force: true }).catch(() => {});

  await expect.poll(async () => page.evaluate(() => (window as any).__SNOTE_E2E_HARD_RELOAD_COUNT__)).toBe(1);
  const mid = await pwaState(page);
  expect(mid?.reloadStrategy).toBe("hard");
  expect(mid?.reloadAttemptCount).toBe(1);

  // Complete the transition.
  await page.evaluate(() => {
    const t = (window as any).__SNOTE_E2E_HELD_TARGET__;
    if (t) (window as any).__SNOTE_E2E_BUILD_ID__ = t;
  });

  await expect(page.getByText("New version available")).toBeHidden({ timeout: 5_000 });
  await expect(page.getByText("Update pending")).toBeHidden();
  const finalCount = await page.evaluate(() => (window as any).__SNOTE_E2E_HARD_RELOAD_COUNT__);
  expect(finalCount).toBe(1);

  await testInfo.attach("pwa-update-hard-reload.json", {
    body: JSON.stringify({ state: await pwaState(page), hardReloadEvents, finalCount }, null, 2),
    contentType: "application/json",
  });
});
