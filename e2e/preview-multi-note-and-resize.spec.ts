// E2E: preview state stays isolated when switching between notes, survives
// F5, and survives rapid back-and-forth viewport resizes. The two storage
// keys (`:wide`, `:narrow`) must never be overwritten by the other viewport.
import { test, expect, type Page } from "@playwright/test";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const PREVIEW_WIDE = "notes:preview-visible:wide";
const PREVIEW_NARROW = "notes:preview-visible:narrow";
const PREVIEW_LEGACY = "notes:preview-visible";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 800 };

function notePath(tag = "") {
  return `/e2e-preview-multi-${tag}-${Math.random().toString(36).slice(2, 8)}`;
}

async function seed(page: Page) {
  await page.addInitScript(
    ({ lang, ip, w, n, l }) => {
      localStorage.setItem(lang, "en");
      localStorage.setItem(ip, "1");
      localStorage.removeItem(w);
      localStorage.removeItem(n);
      localStorage.removeItem(l);
    },
    { lang: LANG_KEY, ip: IP_DETECTED_KEY, w: PREVIEW_WIDE, n: PREVIEW_NARROW, l: PREVIEW_LEGACY },
  );
}

async function previewIsOn(page: Page): Promise<boolean> {
  const hide = page.getByRole("button", { name: /Hide preview|Back to editor/ });
  return (await hide.count()) > 0;
}

test.describe("Markdown preview — isolation across notes", () => {
  test("desktop: toggle off on note A does not flip note B's default after F5", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);

    const a = notePath("a");
    const b = notePath("b");

    await page.goto(a);
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);
    await page.getByRole("button", { name: /Hide preview/ }).first().click();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);

    // Note B is opened in the same viewport — preview key is viewport-scoped,
    // so B reads the *same* desktop value the user last set.
    await page.goto(b);
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);

    // F5 on B keeps the same state.
    await page.reload();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);

    // Back to A: also OFF. (Per-note state was never the design — per-viewport is.)
    await page.goto(a);
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);
  });

  test("mobile choice does not leak to desktop after switching notes + F5", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await seed(page);

    const a = notePath("a");
    const b = notePath("b");

    await page.goto(a);
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);
    await page.getByRole("button", { name: /Show preview/ }).first().click();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    await page.goto(b);
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    // Swap to desktop + F5 — desktop default ON is unaffected.
    await page.setViewportSize(DESKTOP);
    await page.reload();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    const stored = await page.evaluate(
      ({ w, n }) => ({ wide: localStorage.getItem(w), narrow: localStorage.getItem(n) }),
      { w: PREVIEW_WIDE, n: PREVIEW_NARROW },
    );
    expect(stored.narrow).toBe("1");
    expect(stored.wide).toBe("1"); // desktop default written, NOT the narrow value
  });
});

test.describe("Markdown preview — rapid resize does not corrupt storage", () => {
  test("oscillating across the breakpoint preserves per-viewport keys", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);
    await page.goto(notePath("osc"));
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    // Set explicit OFF on desktop, explicit ON on mobile via toggles.
    await page.getByRole("button", { name: /Hide preview/ }).first().click();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);

    await page.setViewportSize(MOBILE);
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);
    await page.getByRole("button", { name: /Show preview/ }).first().click();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    // Now hammer the boundary several times.
    for (let i = 0; i < 6; i++) {
      await page.setViewportSize(i % 2 === 0 ? DESKTOP : MOBILE);
    }

    const stored = await page.evaluate(
      ({ w, n }) => ({ wide: localStorage.getItem(w), narrow: localStorage.getItem(n) }),
      { w: PREVIEW_WIDE, n: PREVIEW_NARROW },
    );
    expect(stored.wide).toBe("0");
    expect(stored.narrow).toBe("1");

    // F5 in each viewport: state restored from the correct key.
    await page.setViewportSize(DESKTOP);
    await page.reload();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);

    await page.setViewportSize(MOBILE);
    await page.reload();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);
  });
});
