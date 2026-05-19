// E2E: Lock / Share / Rename / History / CommandPalette dialogs across
// ALL configured locales × all Playwright browsers (chromium/firefox/webkit).
// Strings are pulled directly from src/i18n so assertions stay exact and
// auto-update when translations change.
import { test, expect, type Page } from "@playwright/test";
import { dict, SUPPORTED_LANGS, type Lang, type TKey } from "../src/i18n/index";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const TOAST_TIMEOUT = 5_000;

const newNotePath = () => `/e2e-dlg-${Math.random().toString(36).slice(2, 8)}`;

const tFor =
  (lang: Lang) =>
  (key: TKey, vars?: Record<string, string | number>): string => {
    let s: string = (dict[lang] as Record<string, string>)[key] ?? (dict.en as Record<string, string>)[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };

async function seedLang(page: Page, lang: Lang) {
  await page.addInitScript(
    ({ k, ik, v }) => {
      localStorage.setItem(k, v);
      localStorage.setItem(ik, "1");
    },
    { k: LANG_KEY, ik: IP_DETECTED_KEY, v: lang },
  );
}

async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined, readText: async () => "" },
    });
  });
}

for (const lang of SUPPORTED_LANGS) {
  const t = tFor(lang);

  test.describe(`dialog i18n — ${lang}`, () => {
    test.beforeEach(async ({ page }) => {
      await seedLang(page, lang);
      await stubClipboard(page);
      await page.goto(newNotePath());
      // wait for topbar to mount
      await expect(page.getByRole("banner")).toBeVisible();
    });

    test("Lock: trigger + dialog title + placeholder are localized", async ({ page }) => {
      await page.getByRole("button", { name: t("lock.aria_encrypt"), exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(t("lock.dialog_title"), { exact: true }).first()).toBeVisible();
      await expect(dialog.getByPlaceholder(t("lock.placeholder"))).toBeVisible();
      await expect(dialog.getByRole("button", { name: t("lock.encrypt_btn"), exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
    });

    test("Share: copy-URL fires exact localized toast", async ({ page }) => {
      await page.getByRole("button", { name: t("share.aria"), exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(t("share.dialog_title"), { exact: true }).first()).toBeVisible();

      // Copy-URL button uses aria-label = t("brand.copy_url")
      const copyAria = (dict[lang] as Record<string, string>)["brand.copy_url"]
        ?? (dict.en as Record<string, string>)["brand.copy_url"];
      const copyBtn = dialog.getByRole("button", { name: copyAria, exact: true }).first();
      await copyBtn.click();

      // Exact toast text + visibility timing.
      const toast = page.getByText(t("share.copied_url"), { exact: true }).first();
      await expect(toast).toBeVisible({ timeout: TOAST_TIMEOUT });
      await page.keyboard.press("Escape");
    });

    test("Rename: inline status text on invalid slug is exact + localized", async ({ page }) => {
      // Rename lives inside the Note dropdown menu.
      await page.getByRole("button", { name: new RegExp(`^${escapeRe(t("menu.note"))}`, "i") }).first().click();
      await page.getByRole("menuitem", { name: t("note.rename"), exact: true }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(t("rename.dialog_title"), { exact: true }).first()).toBeVisible();
      const input = dialog.getByPlaceholder(t("rename.placeholder"));
      await expect(input).toBeVisible();

      // Type an invalid slug → exact localized validation message must show.
      await input.fill("not a valid slug!!");
      await expect(dialog.getByText(t("rename.invalid"), { exact: true })).toBeVisible({
        timeout: TOAST_TIMEOUT,
      });

      // Submit stays disabled — defensive assertion against a real backend call.
      await expect(dialog.getByRole("button", { name: t("rename.submit"), exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
    });

    test("History: dialog title + empty state are exact + localized", async ({ page }) => {
      await page.getByRole("button", { name: new RegExp(`^${escapeRe(t("menu.note"))}`, "i") }).first().click();
      await page.getByRole("menuitem", { name: t("note.history"), exact: true }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(t("history.title"), { exact: true }).first()).toBeVisible();
      await expect(dialog.getByText(t("history.empty"), { exact: true }).first()).toBeVisible();
      await page.keyboard.press("Escape");
    });

    test("CommandPalette: Mod+K opens with exact localized placeholder + Actions group", async ({ page }) => {
      const mod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.press(`${mod}+KeyK`);
      await expect(page.getByPlaceholder(t("cmdk.placeholder"))).toBeVisible();
      await expect(page.getByText(t("cmdk.group_actions"), { exact: true }).first()).toBeVisible();
      await page.keyboard.press("Escape");
    });
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
