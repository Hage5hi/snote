// E2E: throttled/slow network during PWA update poll must not surface an
// update prematurely and must not emit runtime errors.
import { test, expect, type ConsoleMessage } from "@playwright/test";

test("slow /version.json response keeps update flow blocked without errors", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  // Delay every /version.json response by 4s to simulate slow 3G.
  await context.route("**/version.json*", async (route) => {
    await new Promise((r) => setTimeout(r, 4_000));
    await route.continue();
  });

  await page.goto("/");
  await page.waitForTimeout(1_500);

  // While the poll is still in flight, no update surface should appear.
  await expect(page.locator("[data-pwa-update-state]")).toHaveCount(0);
  await expect(page.locator("[data-action='pwa-update']")).toHaveCount(0);

  const filtered = errors.filter((e) => !/version\.json|Failed to fetch|net::ERR|timeout/i.test(e));
  expect(filtered, `unexpected errors under slow network: ${filtered.join("\n")}`).toEqual([]);
});
