// E2E: when the network goes offline mid PWA update poll, the flow must
// stay blocked (no update toast, no crash) and no runtime errors leak.
import { test, expect, type ConsoleMessage } from "@playwright/test";

test("offline network during PWA poll does not surface update or errors", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  // Simulate intermittent /version.json failure.
  await context.route("**/version.json*", (route) => route.abort());

  await page.goto("/");
  await page.waitForTimeout(1_500);

  // No update toast/button surfaced.
  await expect(page.locator("[data-pwa-update-state]")).toHaveCount(0);
  await expect(page.locator("[data-action][data-button]")).toHaveCount(0);

  expect(errors.filter((e) => !/version\.json|Failed to fetch|net::ERR/i.test(e))).toEqual([]);
});
