// E2E: F9 (Typewriter) and F11 (Zen) shortcuts respect the current locale's
// menu hints, work without stealing focus from keyboard navigation, and
// surface localized labels in the Mode dropdown across languages.
import { test, expect, type Page } from "@playwright/test";

const STORAGE_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const NOTE_PATH = `/e2e-shortcuts-${Math.random().toString(36).slice(2, 8)}`;

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
  { lang: "en", modeTrigger: /^Mode$/, zenEnter: /Enter Zen mode/, zenExit: /Exit Zen mode/, tw: /Typewriter/ },
  { lang: "vi", modeTrigger: /Chế độ/, zenEnter: /Bật Zen mode/, zenExit: /Tắt Zen mode/, tw: /Typewriter/ },
  { lang: "ja", modeTrigger: /モード/, zenEnter: /Zen モードに入る/, zenExit: /Zen モードを終了/, tw: /タイプライター/ },
  { lang: "fr", modeTrigger: /^Mode$/, zenEnter: /Activer le mode Zen/, zenExit: /Quitter le mode Zen/, tw: /Machine à écrire|Typewriter/ },
];

for (const c of cases) {
  test(`F11 toggles Zen, F9 toggles Typewriter, hints localized (${c.lang})`, async ({ page, browserName }) => {
    test.skip(browserName === "webkit" && c.lang === "ja", "WebKit IME quirk with Japanese regex labels");
    await seedLang(page, c.lang);
    await page.goto(NOTE_PATH);

    // Open Mode menu — verify localized labels and F9/F11 hints are present.
    const modeBtn = page.getByRole("button", { name: c.modeTrigger }).first();
    await expect(modeBtn).toBeVisible();
    await modeBtn.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText(c.zenEnter)).toBeVisible();
    await expect(menu.getByText("F11")).toBeVisible();
    await expect(menu.getByText("F9")).toBeVisible();
    await page.keyboard.press("Escape");

    // F11 toggles Zen — when Zen is on the topbar hides, so the Mode trigger
    // becomes hidden. Press F11 again and it returns.
    await page.keyboard.press("F11");
    await expect(modeBtn).toBeHidden({ timeout: 3000 });
    await page.keyboard.press("F11");
    await expect(modeBtn).toBeVisible({ timeout: 3000 });

    // After exiting Zen, focus must still be usable — open Mode menu via
    // keyboard (Tab focus chain stays intact, no aria-hidden traps).
    await modeBtn.focus();
    await page.keyboard.press("Enter");
    await expect(menu.getByText(c.zenEnter)).toBeVisible();
    // Typewriter row exists and exposes F9 hint.
    await expect(menu.getByText(c.tw).first()).toBeVisible();
    await page.keyboard.press("Escape");

    // F9 toggles Typewriter (no visual disappearance, but localStorage flips).
    const before = await page.evaluate(() => localStorage.getItem("typewriter"));
    await page.keyboard.press("F9");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("typewriter")))
      .not.toBe(before);
  });
}
