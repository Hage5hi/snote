// E2E: the Markdown preview default must be ON for desktop (≥ 900 px) and
// OFF for mobile (< 900 px) on first visit, must survive F5 within that
// viewport class, must not bleed across viewport classes, and must not be
// affected by switching the color theme.
//
// We detect preview state via the toggle button's aria-label, which is the
// same signal screen-reader users get and is stable across i18n (we pin the
// language to English via initScript).
import { test, expect, type Page } from "@playwright/test";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const PREVIEW_WIDE = "notes:preview-visible:wide";
const PREVIEW_NARROW = "notes:preview-visible:narrow";
const PREVIEW_LEGACY = "notes:preview-visible";

// Fresh note path per worker to avoid persisted Yjs content from other suites.
function notePath() {
  return `/e2e-preview-${Math.random().toString(36).slice(2, 10)}`;
}

async function seed(page: Page) {
  await page.addInitScript(
    ({ lang, ip, w, n, l }) => {
      localStorage.setItem(lang, "en");
      localStorage.setItem(ip, "1");
      // Always start from a clean slate so we measure the FIRST-VISIT
      // default, not whatever a previous spec wrote.
      localStorage.removeItem(w);
      localStorage.removeItem(n);
      localStorage.removeItem(l);
    },
    {
      lang: LANG_KEY,
      ip: IP_DETECTED_KEY,
      w: PREVIEW_WIDE,
      n: PREVIEW_NARROW,
      l: PREVIEW_LEGACY,
    },
  );
}

// When preview is ON, the toggle's aria-label is "Hide preview" (wide) or
// "Back to editor" (narrow). When OFF it is "Show preview".
async function previewIsOn(page: Page): Promise<boolean> {
  const hide = page.getByRole("button", { name: /Hide preview|Back to editor/ });
  return (await hide.count()) > 0;
}

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 800 };

test.describe("Markdown preview default by viewport", () => {
  test("desktop default is ON, persists across F5", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);
    await page.goto(notePath());

    await expect
      .poll(() => previewIsOn(page), { timeout: 5000 })
      .toBe(true);

    await page.reload();
    await expect
      .poll(() => previewIsOn(page), { timeout: 5000 })
      .toBe(true);
  });

  test("mobile default is OFF, persists across F5", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await seed(page);
    await page.goto(notePath());

    await expect
      .poll(() => previewIsOn(page), { timeout: 5000 })
      .toBe(false);

    await page.reload();
    await expect
      .poll(() => previewIsOn(page), { timeout: 5000 })
      .toBe(false);
  });

  test("mobile toggling ON does not change desktop default after F5", async ({ page }) => {
    // Mobile: toggle preview ON.
    await page.setViewportSize(MOBILE);
    await seed(page);
    const path = notePath();
    await page.goto(path);
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);
    await page.getByRole("button", { name: /Show preview/ }).first().click();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    // Now resize to desktop and reload — desktop must still default ON,
    // independent of the explicit mobile ON we just stored.
    await page.setViewportSize(DESKTOP);
    await page.reload();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    // Confirm storage is split per-viewport.
    const stored = await page.evaluate(
      ({ w, n }) => ({
        wide: localStorage.getItem(w),
        narrow: localStorage.getItem(n),
      }),
      { w: PREVIEW_WIDE, n: PREVIEW_NARROW },
    );
    expect(stored.narrow).toBe("1");
    expect(stored.wide).toBe("1"); // desktop default re-asserted, not overwritten by mobile
  });

  test("desktop toggling OFF does not change mobile default after F5", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);
    const path = notePath();
    await page.goto(path);
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);
    await page.getByRole("button", { name: /Hide preview/ }).first().click();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);

    await page.setViewportSize(MOBILE);
    await page.reload();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);
  });
});

test.describe("Markdown preview is independent of color theme", () => {
  test("desktop: switching theme does not flip preview default after F5", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);
    await page.goto(notePath());
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    // Open the theme menu and pick a different option (any radio item works).
    await page.getByRole("button", { name: /Theme settings/ }).first().click();
    const items = page.getByRole("menuitemradio");
    const count = await items.count();
    expect(count).toBeGreaterThan(1);
    // Click the second option to guarantee a real change.
    await items.nth(1).click();

    await page.reload();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);
  });

  test("mobile: switching theme does not flip preview default after F5", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await seed(page);
    await page.goto(notePath());
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);

    await page.getByRole("button", { name: /Theme settings/ }).first().click();
    const items = page.getByRole("menuitemradio");
    if ((await items.count()) > 1) {
      await items.nth(1).click();
    }

    await page.reload();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);
  });
});
