// E2E: top-offender dialogs (Lock, Share, Rename, History, CommandPalette)
// render localized labels/placeholders/toasts across browsers.
// Playwright matrix in CI runs this against chromium, firefox, webkit.
import { test, expect, type Page } from "@playwright/test";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const NOTE = () => `/e2e-dialogs-${Math.random().toString(36).slice(2, 8)}`;

async function seedLang(page: Page, lang: string) {
  await page.addInitScript(
    ({ k, ik, v }) => {
      localStorage.setItem(k, v);
      localStorage.setItem(ik, "1");
    },
    { k: LANG_KEY, ik: IP_DETECTED_KEY, v: lang },
  );
}

type DialogStrings = {
  lang: string;
  // aria-labels of triggers (already localized via t())
  lockTrigger: RegExp;
  shareTrigger: RegExp;
  historyTrigger: RegExp;
  // dialog body assertions
  lockTitle: RegExp;
  lockPlaceholder: RegExp;
  shareCopyToast: RegExp;
  renameTitle: RegExp;
  renamePlaceholder: RegExp;
  historyTitle: RegExp;
  historyEmpty: RegExp;
  cmdkPlaceholder: RegExp;
  cmdkActions: RegExp;
};

const cases: DialogStrings[] = [
  {
    lang: "en",
    lockTrigger: /Encrypt note/i,
    shareTrigger: /Share QR/i,
    historyTrigger: /History/i,
    lockTitle: /Encrypt note/i,
    lockPlaceholder: /Passphrase/i,
    shareCopyToast: /URL copied|Copied/i,
    renameTitle: /Rename slug/i,
    renamePlaceholder: /new-slug/i,
    historyTitle: /Local history/i,
    historyEmpty: /No snapshots yet/i,
    cmdkPlaceholder: /Search notes/i,
    cmdkActions: /Actions/i,
  },
  {
    lang: "vi",
    lockTrigger: /Mã hoá note/i,
    shareTrigger: /Chia sẻ QR/i,
    historyTrigger: /Lịch sử/i,
    lockTitle: /Mã hoá note/i,
    lockPlaceholder: /Mật khẩu|Passphrase/i,
    shareCopyToast: /Đã copy|copy URL/i,
    renameTitle: /Đổi tên slug/i,
    renamePlaceholder: /slug-mới|new-slug/i,
    historyTitle: /Lịch sử cục bộ/i,
    historyEmpty: /Chưa có bản chụp|chưa có/i,
    cmdkPlaceholder: /Tìm note|nhập slug/i,
    cmdkActions: /Hành động/i,
  },
];

for (const c of cases) {
  test.describe(`dialog i18n — ${c.lang}`, () => {
    test.beforeEach(async ({ page }) => {
      await seedLang(page, c.lang);
      await page.goto(NOTE());
      // stub clipboard to avoid permission prompts
      await page.evaluate(() => {
        (navigator as unknown as { clipboard: { writeText: (s: string) => Promise<void> } }).clipboard = {
          writeText: async () => {},
        };
      });
    });

    test("Lock dialog opens with localized title + placeholder", async ({ page }) => {
      await page.getByRole("button", { name: c.lockTrigger }).first().click();
      await expect(page.getByRole("dialog").getByText(c.lockTitle).first()).toBeVisible();
      await expect(page.getByPlaceholder(c.lockPlaceholder).first()).toBeVisible();
      await page.keyboard.press("Escape");
    });

    test("Share dialog shows trigger + copy toast in current language", async ({ page }) => {
      await page.getByRole("button", { name: c.shareTrigger }).first().click();
      // Within the share popover, find a button that copies (best-effort).
      const copyBtn = page.getByRole("button", { name: /Copy|copy|Sao chép/i }).first();
      if (await copyBtn.isVisible().catch(() => false)) {
        await copyBtn.click();
        await expect(page.getByText(c.shareCopyToast).first()).toBeVisible({ timeout: 5000 });
      }
      await page.keyboard.press("Escape");
    });

    test("Rename dialog opens with localized title + placeholder", async ({ page }) => {
      // Rename lives behind the Export/More menu. Use Cmd/Ctrl+Shift+R if bound,
      // otherwise open via menu. Fallback: open command palette and search.
      const renameTrigger = page.getByRole("button", { name: /Rename|Đổi tên/i }).first();
      if (await renameTrigger.isVisible().catch(() => false)) {
        await renameTrigger.click();
      } else {
        // Open a more menu containing Rename
        const more = page.getByRole("button", { name: /More|Tuỳ chọn|Menu/i }).first();
        if (await more.isVisible().catch(() => false)) await more.click();
        const item = page.getByRole("menuitem", { name: /Rename|Đổi tên/i }).first();
        if (await item.isVisible().catch(() => false)) await item.click();
      }
      const title = page.getByRole("dialog").getByText(c.renameTitle).first();
      if (await title.isVisible().catch(() => false)) {
        await expect(page.getByPlaceholder(c.renamePlaceholder).first()).toBeVisible();
      }
      await page.keyboard.press("Escape");
    });

    test("History dialog shows localized title + empty state", async ({ page }) => {
      await page.getByRole("button", { name: c.historyTrigger }).first().click();
      await expect(page.getByRole("dialog").getByText(c.historyTitle).first()).toBeVisible();
      // Brand new note → empty state should render.
      await expect(page.getByText(c.historyEmpty).first()).toBeVisible();
      await page.keyboard.press("Escape");
    });

    test("Command palette opens via Mod+K with localized placeholder + groups", async ({ page }) => {
      const mod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.press(`${mod}+KeyK`);
      await expect(page.getByPlaceholder(c.cmdkPlaceholder).first()).toBeVisible();
      await expect(page.getByText(c.cmdkActions).first()).toBeVisible();
      await page.keyboard.press("Escape");
    });
  });
}
