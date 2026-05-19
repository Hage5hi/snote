// E2E: Export & Help menus render localized strings (toast, modal label,
// placeholder) across languages and browsers. CI runs this on chromium,
// firefox, webkit via PLAYWRIGHT_PROJECT in playwright.config.ts.
import { test, expect, type Page } from "@playwright/test";

const STORAGE_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const NOTE_PATH = `/e2e-exporthelp-${Math.random().toString(36).slice(2, 8)}`;

async function seedLang(page: Page, lang: string) {
  await page.addInitScript(
    ({ k, ik, v }) => {
      localStorage.setItem(k, v);
      localStorage.setItem(ik, "1");
    },
    { k: STORAGE_KEY, ik: IP_DETECTED_KEY, v: lang },
  );
}

type Case = {
  lang: string;
  helpTrigger: RegExp;
  exportItem: RegExp;
  copyUrlItem: RegExp;
  copyUrlToast: RegExp;
  splitHint: RegExp;
};

const cases: Case[] = [
  {
    lang: "en",
    helpTrigger: /^Help$/,
    exportItem: /^Download \.md/,
    copyUrlItem: /Copy note URL/i,
    copyUrlToast: /URL copied/i,
    splitHint: /Split view/i,
  },
  {
    lang: "vi",
    helpTrigger: /Trợ giúp/,
    exportItem: /Tải \.md/,
    copyUrlItem: /Copy URL note/i,
    copyUrlToast: /Đã copy URL/,
    splitHint: /Chế độ split/i,
  },
  {
    lang: "fr",
    helpTrigger: /Aide/,
    exportItem: /Télécharger \.md/i,
    copyUrlItem: /Copier l['']URL/i,
    copyUrlToast: /URL copiée|copié/i,
    splitHint: /Vue divisée|fractionnée/i,
  },
  {
    lang: "ja",
    helpTrigger: /ヘルプ/,
    exportItem: /\.md.*ダウンロード|ダウンロード.*\.md/,
    copyUrlItem: /URL.*コピー/,
    copyUrlToast: /URL.*コピー/,
    splitHint: /分割/,
  },
];

for (const c of cases) {
  test(`Export + Help i18n (${c.lang})`, async ({ page }) => {
    await seedLang(page, c.lang);
    await page.goto(NOTE_PATH);

    // Stub clipboard so the toast fires without permission prompt.
    await page.evaluate(() => {
      (navigator as unknown as { clipboard: { writeText: (s: string) => Promise<void> } }).clipboard = {
        writeText: async () => {},
      };
    });

    // Help menu — localized trigger and content.
    await page.getByRole("button", { name: c.helpTrigger }).first().click();
    await expect(page.getByText(c.splitHint).first()).toBeVisible();
    // Close menu by pressing Escape.
    await page.keyboard.press("Escape");

    // Export menu — localized items.
    await page.getByRole("button", { name: /^Export$|Exportar|Exporter|エクスポート|导出|내보내기/ }).first().click();
    await expect(page.getByRole("menuitem", { name: c.exportItem }).first()).toBeVisible();

    // Copy URL toast in current language.
    await page.getByRole("menuitem", { name: c.copyUrlItem }).first().click();
    await expect(page.getByText(c.copyUrlToast).first()).toBeVisible({ timeout: 5000 });
  });
}
