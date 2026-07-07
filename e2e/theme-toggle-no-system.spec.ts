// E2E: theme toggle never renders a "System" option or 3-choice dropdown,
// including after page refreshes.
import { test, expect } from "@playwright/test";

const NOTE_PATH = `/e2e-theme-hard-${Math.random().toString(36).slice(2, 8)}`;
const SYSTEM_RE = /^(system|theo hệ thống|theo h\u1ec7 th\u1ed1ng|系统|システム|시스템|système|sistema|systemeinstellung)$/i;

test("theme toggle stays a direct light/dark switch across reloads", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
    localStorage.setItem("theme", "light");
  });

  for (let i = 0; i < 3; i++) {
    await page.goto(NOTE_PATH);

    const toggle = page.getByRole("button", { name: /theme|giao diện/i }).first();
    await expect(toggle).toBeVisible();

    await toggle.click();

    // Never a menu, never a 3-choice popover, never a "System" option.
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("menuitem")).toHaveCount(0);
    await expect(page.getByText(SYSTEM_RE)).toHaveCount(0);

    // A second click also must not open a menu.
    await toggle.click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByText(SYSTEM_RE)).toHaveCount(0);

    await page.reload();
  }
});
