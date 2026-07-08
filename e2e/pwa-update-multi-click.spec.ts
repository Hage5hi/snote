// E2E: clicking Update multiple times only triggers one reload path and the
// note URL never gains a ?v= cache-buster, even under rapid repeated clicks.
import { expect, test } from "@playwright/test";
import { getHardReloadCount, installPwaUpdateMock, waitForPwaUpdaterReady } from "./helpers/pwa-update-mock";

test("multiple Update clicks apply the new build without adding ?v to the URL", async ({ page }, testInfo) => {
  await installPwaUpdateMock(page, {
    fromBuildId: "build-multi-v1",
    toBuildId: "build-multi-v2",
  });

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
  expect(url.pathname).toBe("/my-note");
  expect(url.searchParams.get("foo")).toBe("bar");
  expect(url.searchParams.has("v")).toBe(false);
});
