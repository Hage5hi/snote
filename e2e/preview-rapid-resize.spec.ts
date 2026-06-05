// E2E: long-running rapid resize across the 900 px breakpoint must not
// thrash the doc-cache (excessive acquire/destroy) and must leave preview
// state consistent with the *final* viewport class after several F5 cycles.
import { test, expect, type Page } from "@playwright/test";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const PREVIEW_WIDE = "notes:preview-visible:wide";
const PREVIEW_NARROW = "notes:preview-visible:narrow";
const PREVIEW_LEGACY = "notes:preview-visible";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 800 };

function notePath() {
  return `/e2e-rapid-${Math.random().toString(36).slice(2, 10)}`;
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

async function metrics(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __docCacheMetrics?: () => { acquireHit: number; acquireMiss: number; destroyed: number; size: number };
    };
    return w.__docCacheMetrics?.() ?? null;
  });
}

test.describe("Markdown preview + doc-cache — rapid resize stability", () => {
  test("50 desktop↔mobile flips do not thrash the cache", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);
    await page.goto(notePath());
    await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 10_000 });

    const before = await metrics(page);

    for (let i = 0; i < 50; i++) {
      await page.setViewportSize(i % 2 === 0 ? MOBILE : DESKTOP);
    }

    const after = await metrics(page);
    if (before && after) {
      // Resize alone must NOT cause the editor's doc to be destroyed —
      // we only change layout, not the slug. Allow tiny slack (≤1) in
      // case a transient layout swap re-acquires once.
      expect(after.destroyed - before.destroyed).toBeLessThanOrEqual(1);
      expect(after.acquireMiss - before.acquireMiss).toBeLessThanOrEqual(1);
    }
  });

  test("preview state after rapid resize matches the final viewport across F5", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);
    await page.goto(notePath());
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    for (let i = 0; i < 20; i++) {
      await page.setViewportSize(i % 2 === 0 ? MOBILE : DESKTOP);
    }
    // Final viewport: DESKTOP (i=19 → DESKTOP). Reload three times; preview
    // must stay ON for the desktop class.
    await page.setViewportSize(DESKTOP);
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);
    }

    // Now end on mobile; preview must stay OFF across three F5s.
    await page.setViewportSize(MOBILE);
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);
    }
  });
});
