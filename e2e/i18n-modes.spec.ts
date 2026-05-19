// E2E: Mode menu labels, keyboard shortcut hints, and i18n strings per language.
// Verifies the Mode dropdown renders the localized label + shortcut codes
// (F9/F11) for several supported languages.
import { test, expect, type Page } from "@playwright/test";

const STORAGE_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const NOTE_PATH = `/e2e-modes-${Math.random().toString(36).slice(2, 8)}`;

async function seedLang(page: Page, lang: string) {
  await page.addInitScript(
    ({ k, ik, v }) => {
      localStorage.setItem(k, v);
      localStorage.setItem(ik, "1");
    },
    { k: STORAGE_KEY, ik: IP_DETECTED_KEY, v: lang },
  );
}

const cases = [
  { lang: "en", trigger: /^Mode$/, zen: /Enter Zen mode/, desc: /Hide toolbar/ },
  { lang: "vi", trigger: /Chế độ/, zen: /Bật Zen mode/, desc: /Ẩn toolbar/ },
  { lang: "ja", trigger: /モード/, zen: /Zen|禅/, desc: /./ },
  { lang: "fr", trigger: /Mode/, zen: /Zen/, desc: /./ },
];

for (const c of cases) {
  test(`Mode menu localized + shortcut hints (${c.lang})`, async ({ page }) => {
    await seedLang(page, c.lang);
    await page.goto(NOTE_PATH);

    const trigger = page.getByRole("button", { name: c.trigger }).first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    // First item is Zen-mode toggle, localized, with F11 shortcut hint.
    const menu = page.getByRole("menu");
    await expect(menu.getByText(c.zen)).toBeVisible();
    await expect(menu.getByText("F11")).toBeVisible();
    await expect(menu.getByText("F9")).toBeVisible();
  });
}
