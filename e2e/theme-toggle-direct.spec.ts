// E2E: ThemeToggle is a direct light/dark switch — no dropdown, no "System".
import { test, expect } from "@playwright/test";

test("theme toggle flips light/dark directly with no menu or System option", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
    localStorage.setItem("theme", "light");
  });
  await page.goto("/");

  const toggle = page.getByRole("button", { name: /theme|giao diện/i }).first();
  await expect(toggle).toBeVisible();

  const htmlClass = () => page.evaluate(() => document.documentElement.className);
  const before = await htmlClass();

  await toggle.click();

  // No dropdown menu should appear.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  // No "System" / "Theo hệ thống" option surfaced anywhere.
  await expect(page.getByText(/^(System|Theo hệ thống)$/i)).toHaveCount(0);

  // The theme actually flipped.
  await expect
    .poll(async () => (await htmlClass()) !== before, { timeout: 2000 })
    .toBe(true);

  const afterFirst = await htmlClass();
  const wasDark = before.includes("dark");
  const isDark = afterFirst.includes("dark");
  expect(isDark).toBe(!wasDark);

  // Second click flips back.
  await toggle.click();
  await expect.poll(htmlClass, { timeout: 2000 }).toBe(before);
});
