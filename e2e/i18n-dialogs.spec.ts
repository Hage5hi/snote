// E2E: Lock / Share / Rename / History / CommandPalette dialogs across
// ALL configured locales × all Playwright browsers (chromium/firefox/webkit).
// Strings are pulled directly from src/i18n so assertions stay exact and
// auto-update when translations change.
import { test, expect, type Page } from "@playwright/test";
import { dict, SUPPORTED_LANGS, type Lang, type TKey } from "../src/i18n/index";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
// CI runners are slower than local dev — allow overrides via env so we can
// loosen thresholds without touching code. Defaults double under CI.
const CI_MULT = process.env.CI ? 2 : 1;
const TOAST_TIMEOUT = Number(process.env.E2E_TOAST_TIMEOUT_MS ?? 5_000) * CI_MULT;
// Sonner default auto-dismiss ≈ 4s; allow generous slack for slower browsers.
const TOAST_DISMISS_TIMEOUT =
  Number(process.env.E2E_TOAST_DISMISS_TIMEOUT_MS ?? 8_000) * CI_MULT;
// Minimum time a success toast should remain visible before auto-dismiss.
const TOAST_MIN_VISIBLE_MS = Number(process.env.E2E_TOAST_MIN_VISIBLE_MS ?? 200);

/** Assert a toast becomes visible, stays visible briefly, then auto-dismisses. */
async function expectToastLifecycle(
  locator: import("@playwright/test").Locator,
): Promise<void> {
  await expect(locator).toBeVisible({ timeout: TOAST_TIMEOUT });
  // Confirm it doesn't flicker out immediately.
  await locator.page().waitForTimeout(TOAST_MIN_VISIBLE_MS);
  await expect(locator).toBeVisible();
  // Then verify it does dismiss within the configured window.
  await expect(locator).toBeHidden({ timeout: TOAST_DISMISS_TIMEOUT });
}

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

// Prevent location.replace/assign from navigating away mid-test (Lock + Rename
// both navigate on success). Keeps the toast measurable.
async function stubNavigation(page: Page) {
  await page.addInitScript(() => {
    try {
      const noop = () => undefined;
      Object.defineProperty(window.location, "replace", { value: noop, configurable: true });
      Object.defineProperty(window.location, "assign", { value: noop, configurable: true });
    } catch {
      /* some browsers freeze location — best-effort only */
    }
  });
}

// Route-level stubs for Supabase REST + edge functions so destructive flows
// can run end-to-end without a real backend. Caller decides whether writes
// succeed (toast = success) or fail (toast = failure).
async function stubSupabase(page: Page, opts: { writesSucceed: boolean }) {
  await page.route("**/rest/v1/notes**", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      // maybeSingle → null  ⇒ slug is "available"
      return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    }
    if (method === "POST" || method === "PATCH" || method === "DELETE") {
      return opts.writesSucceed
        ? route.fulfill({ status: 201, contentType: "application/json", body: "[]" })
        : route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "stubbed failure" }) });
    }
    return route.continue();
  });
  await page.route("**/functions/v1/**", async (route) => {
    return opts.writesSucceed
      ? route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
      : route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "stubbed failure" }) });
  });
}

for (const lang of SUPPORTED_LANGS) {
  const t = tFor(lang);

  test.describe(`dialog i18n — ${lang}`, () => {
    test.beforeEach(async ({ page }) => {
      await seedLang(page, lang);
      await stubClipboard(page);
      await stubNavigation(page);
      await page.goto(newNotePath());
      await expect(page.getByRole("banner")).toBeVisible();
    });

    // ---------- LOCK ------------------------------------------------------

    test("Lock dialog: every interactive element is localized", async ({ page }) => {
      // Trigger has localized aria-label + tooltip.
      const trigger = page.getByRole("button", { name: t("lock.aria_encrypt"), exact: true }).first();
      await expect(trigger).toHaveAttribute("aria-label", t("lock.aria_encrypt"));
      await trigger.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // Title + description.
      await expect(dialog.getByText(t("lock.dialog_title"), { exact: true }).first()).toBeVisible();
      await expect(dialog.getByText(t("lock.dialog_desc"), { exact: true }).first()).toBeVisible();
      // Passphrase input placeholder.
      await expect(dialog.getByPlaceholder(t("lock.placeholder"))).toBeVisible();
      // Every interactive button: Generate, Cancel, Encrypt.
      await expect(dialog.getByRole("button", { name: t("lock.generate"), exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: t("lock.cancel"), exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: t("lock.encrypt_btn"), exact: true })).toBeVisible();
      // Warning copy.
      await expect(dialog.getByText(t("lock.warning"), { exact: true }).first()).toBeVisible();
      await page.keyboard.press("Escape");
    });

    test("Lock: success toast appears and dismisses within window", async ({ page }) => {
      await stubSupabase(page, { writesSucceed: true });

      await page.getByRole("button", { name: t("lock.aria_encrypt"), exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      await dialog.getByPlaceholder(t("lock.placeholder")).fill("a-strong-enough-key");
      await dialog.getByRole("button", { name: t("lock.encrypt_btn"), exact: true }).click();

      const toast = page.getByText(t("lock.encrypted_ok"), { exact: true }).first();
      await expect(toast).toBeVisible({ timeout: TOAST_TIMEOUT });
      await expect(toast).toBeHidden({ timeout: TOAST_DISMISS_TIMEOUT });
    });

    // ---------- SHARE -----------------------------------------------------

    test("Share dialog: every interactive element is localized", async ({ page }) => {
      const trigger = page.getByRole("button", { name: t("share.aria"), exact: true }).first();
      await expect(trigger).toHaveAttribute("aria-label", t("share.aria"));
      await trigger.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(t("share.dialog_title"), { exact: true }).first()).toBeVisible();
      await expect(dialog.getByText(t("share.dialog_desc"), { exact: true }).first()).toBeVisible();

      // Copy-URL icon button — aria-label = brand.copy_url.
      const copyAria = (dict[lang] as Record<string, string>)["brand.copy_url"]
        ?? (dict.en as Record<string, string>)["brand.copy_url"];
      const copyBtn = dialog.getByRole("button", { name: copyAria, exact: true }).first();
      await expect(copyBtn).toHaveAttribute("aria-label", copyAria);

      // Read-only section heading + create button (token is absent on fresh notes).
      await expect(dialog.getByText(t("share.readonly_heading"), { exact: true }).first()).toBeVisible();
      await expect(dialog.getByText(t("share.readonly_desc"), { exact: true }).first()).toBeVisible();
      await expect(dialog.getByRole("button", { name: t("share.create_btn"), exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
    });

    test("Share: copy-URL toast appears and dismisses within window", async ({ page }) => {
      await page.getByRole("button", { name: t("share.aria"), exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      const copyAria = (dict[lang] as Record<string, string>)["brand.copy_url"]
        ?? (dict.en as Record<string, string>)["brand.copy_url"];
      await dialog.getByRole("button", { name: copyAria, exact: true }).first().click();

      const toast = page.getByText(t("share.copied_url"), { exact: true }).first();
      await expect(toast).toBeVisible({ timeout: TOAST_TIMEOUT });
      await expect(toast).toBeHidden({ timeout: TOAST_DISMISS_TIMEOUT });
    });

    // ---------- RENAME ----------------------------------------------------

    test("Rename dialog: every interactive element is localized", async ({ page }) => {
      await page.getByRole("button", { name: new RegExp(`^${escapeRe(t("menu.note"))}`, "i") }).first().click();
      await page.getByRole("menuitem", { name: t("note.rename"), exact: true }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(t("rename.dialog_title"), { exact: true }).first()).toBeVisible();

      const input = dialog.getByPlaceholder(t("rename.placeholder"));
      await expect(input).toBeVisible();
      await expect(input).toHaveAttribute("placeholder", t("rename.placeholder"));

      // Warning lines below the input.
      await expect(dialog.getByText(t("rename.warn_other_tabs"), { exact: true }).first()).toBeVisible();

      // Footer buttons.
      await expect(dialog.getByRole("button", { name: t("rename.cancel"), exact: true })).toBeVisible();
      const submit = dialog.getByRole("button", { name: t("rename.submit"), exact: true });
      await expect(submit).toBeVisible();
      await expect(submit).toBeDisabled();

      // Invalid → exact localized inline error.
      await input.fill("not a valid slug!!");
      await expect(dialog.getByText(t("rename.invalid"), { exact: true })).toBeVisible({ timeout: TOAST_TIMEOUT });
      await expect(submit).toBeDisabled();
      await page.keyboard.press("Escape");
    });

    test("Rename: failure toast appears and dismisses within window", async ({ page }) => {
      // GET → null (available), POST/PATCH → 500 (rename fails) ⇒ toast_failed.
      await stubSupabase(page, { writesSucceed: false });

      await page.getByRole("button", { name: new RegExp(`^${escapeRe(t("menu.note"))}`, "i") }).first().click();
      await page.getByRole("menuitem", { name: t("note.rename"), exact: true }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const input = dialog.getByPlaceholder(t("rename.placeholder"));
      await input.fill("renamed-target");

      // Wait until "available" status enables the submit button.
      const submit = dialog.getByRole("button", { name: t("rename.submit"), exact: true });
      await expect(submit).toBeEnabled({ timeout: TOAST_TIMEOUT });
      await submit.click();

      const toast = page.getByText(t("rename.toast_failed"), { exact: true }).first();
      await expect(toast).toBeVisible({ timeout: TOAST_TIMEOUT });
      await expect(toast).toBeHidden({ timeout: TOAST_DISMISS_TIMEOUT });
    });

    // ---------- HISTORY ---------------------------------------------------

    test("History: dialog title + empty state are exact + localized", async ({ page }) => {
      await page.getByRole("button", { name: new RegExp(`^${escapeRe(t("menu.note"))}`, "i") }).first().click();
      await page.getByRole("menuitem", { name: t("note.history"), exact: true }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(t("history.title"), { exact: true }).first()).toBeVisible();
      await expect(dialog.getByText(t("history.empty"), { exact: true }).first()).toBeVisible();
      await page.keyboard.press("Escape");
    });

    // ---------- COMMAND PALETTE ------------------------------------------

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
