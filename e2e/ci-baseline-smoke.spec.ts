import { expect, test } from "@playwright/test";

test("application shell serves and renders the home route without page errors", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });

  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/Syrin Notes/i);
  await expect(page.locator("#root main h1")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
