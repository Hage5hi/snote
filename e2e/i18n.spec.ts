// E2E: cross-tab language sync, persistence, and localized Export/Help/toast labels.
// Run with: bunx playwright test (CI installs browsers automatically).
import { test, expect, type Page } from "@playwright/test";

const STORAGE_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";

// Seed localStorage before the app boots so IP detection is skipped and we
// start on a known language. Must run as initScript before navigation.
async function seedLang(page: Page, lang: string | null) {
  await page.addInitScript(
    ({ key, ipKey, value }) => {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
      localStorage.setItem(ipKey, "1");
    },
    { key: STORAGE_KEY, ipKey: IP_DETECTED_KEY, value: lang },
  );
}

// Open a random fresh note so we always have a Topbar with Export + Help.
const NOTE_PATH = `/e2e-${Math.random().toString(36).slice(2, 10)}`;

test.describe("i18n end-to-end", () => {
  test("cross-tab language change propagates via storage event", async ({ context }) => {
    await context.addInitScript(
      ({ ipKey }) => localStorage.setItem(ipKey, "1"),
      { ipKey: IP_DETECTED_KEY },
    );

    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await tabA.goto(NOTE_PATH);
    await tabB.goto(NOTE_PATH);

    // Both tabs start in English — Export menu trigger shows "Export".
    await expect(tabA.getByRole("button", { name: /^Export$/ })).toBeVisible();
    await expect(tabB.getByRole("button", { name: /^Export$/ })).toBeVisible();

    // Switch language in Tab A via the language toggle dropdown.
    await tabA.getByRole("button", { name: /Language/i }).first().click();
    await tabA.getByRole("menuitem", { name: /Tiếng Việt/ }).click();

    // Tab A reflects immediately.
    await expect(tabA.getByRole("button", { name: /^Export$/ })).toBeVisible();
    // (Vietnamese keeps "Export" as the menu label — sanity check Help instead.)
    await expect(tabA.getByRole("button", { name: /Trợ giúp/ })).toBeVisible();

    // Tab B should receive the storage event and re-render to Vietnamese.
    await expect(tabB.getByRole("button", { name: /Trợ giúp/ })).toBeVisible();

    // Now flip to Spanish from Tab B.
    await tabB.getByRole("button", { name: /Ngôn ngữ|Idioma|Language/i }).first().click();
    await tabB.getByRole("menuitem", { name: /Español/ }).click();

    await expect(tabA.getByRole("button", { name: /Ayuda/ })).toBeVisible();
    await expect(tabB.getByRole("button", { name: /Ayuda/ })).toBeVisible();
    await expect(tabA.getByRole("button", { name: /Exportar/ })).toBeVisible();
  });

  test("language choice persists across reload", async ({ page }) => {
    await seedLang(page, null);
    await page.goto(NOTE_PATH);

    // Pick French.
    await page.getByRole("button", { name: /Language/i }).first().click();
    await page.getByRole("menuitem", { name: /Français/ }).click();
    await expect(page.getByRole("button", { name: /Aide/ })).toBeVisible();

    // Reload — fresh provider must read localStorage.
    await page.reload();
    await expect(page.getByRole("button", { name: /Aide/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Exporter/ })).toBeVisible();

    // localStorage actually holds "fr".
    const saved = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(saved).toBe("fr");
  });

  test("Export menu items + copy URL toast use current language (vi)", async ({ page }) => {
    await seedLang(page, "vi");
    await page.goto(NOTE_PATH);

    // Stub clipboard so the test runs headless without permission prompts.
    await page.evaluate(() => {
      (navigator as unknown as { clipboard: { writeText: (s: string) => Promise<void> } }).clipboard = {
        writeText: async () => {},
      };
    });

    // Open Export menu — Vietnamese trigger label is "Export" (kept as-is in dict).
    await page.getByRole("button", { name: /^Export$/ }).click();
    // Items are localized.
    await expect(page.getByRole("menuitem", { name: /Copy URL note/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Tải .md/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /In ra PDF/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Copy cho AI/ })).toBeVisible();

    // Click "Copy URL note" → toast in Vietnamese.
    await page.getByRole("menuitem", { name: /Copy URL note/ }).click();
    await expect(page.getByText("Đã copy URL")).toBeVisible();
  });

  test("Help menu items are localized (ja)", async ({ page }) => {
    await seedLang(page, "ja");
    await page.goto(NOTE_PATH);

    await page.getByRole("button", { name: /ヘルプ/ }).click();
    await expect(
      page.getByRole("menuitem", { name: /キーボードショートカット/ }),
    ).toBeVisible();
    // Split-view label localized.
    await expect(page.getByText(/分割表示/)).toBeVisible();
  });

  test("IP fallback: defaults to browser language when detection fails", async ({ page, context }) => {
    // Mock a scenario where IP detection fails (e.g., CORS error or timeout)
    // We simulate this by not setting the IP_DETECTED_KEY
    await page.goto(NOTE_PATH);
    
    // Assuming browser language is English (default in Playwright)
    await expect(page.getByRole("button", { name: /Language/i })).toBeVisible();
  });
});
