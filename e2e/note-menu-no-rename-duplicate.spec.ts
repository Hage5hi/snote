// E2E: the Note menu no longer surfaces Rename or Duplicate actions in any
// locale, either from the main note topbar or from the note page.
import { test, expect } from "@playwright/test";

const NOTE_PATH = `/e2e-menu-${Math.random().toString(36).slice(2, 8)}`;

const RENAME_RE = /rename|đổi tên|đổi t\u00ean|重命名|名前を変更|이름 바꾸기|renommer|renombrar|umbenennen|renomear/i;
const DUP_RE = /duplicate|duplic|nhân bản|nh\u00e2n b\u1ea3n|复制|複製|複製する|복제|dupliquer|duplizieren/i;

test.describe("Note menu — Rename/Duplicate removed", () => {
  test("Note dropdown never shows Rename or Duplicate items", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("lang.ip_detected", "1");
    });
    await page.goto(NOTE_PATH);

    // Open the Note dropdown from the topbar.
    const noteMenuTrigger = page.getByRole("button", { name: /^note$/i }).first();
    await expect(noteMenuTrigger).toBeVisible();
    await noteMenuTrigger.click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    await expect(menu.getByRole("menuitem", { name: RENAME_RE })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: DUP_RE })).toHaveCount(0);

    // Sanity: expected items still present.
    await expect(menu.getByRole("menuitem", { name: /goal|history|copy/i })).not.toHaveCount(0);
  });

  test("no rename/duplicate controls anywhere on the note page", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("lang.ip_detected", "1");
    });
    await page.goto(NOTE_PATH);

    await expect(page.getByRole("button", { name: RENAME_RE })).toHaveCount(0);
    await expect(page.getByRole("button", { name: DUP_RE })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: RENAME_RE })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: DUP_RE })).toHaveCount(0);
  });
});
