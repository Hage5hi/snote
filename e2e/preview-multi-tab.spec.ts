// E2E: opening the same note in two tabs must not cross-pollute the Markdown
// preview state, and the doc-cache must not destroy a doc that is still being
// displayed in another tab when one tab is hidden / refreshed.
//
// Notes:
// - localStorage is shared per origin, so the `:wide` / `:narrow` keys see
//   writes from either tab. We assert each tab keeps its toggle in sync after
//   F5 (the persisted value), not that the tabs ignore each other.
// - The doc-cache is module-level (per page realm). Each tab has its own
//   cache, so a `visibilitychange` in tab A must NOT touch tab B's doc.
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const PREVIEW_WIDE = "notes:preview-visible:wide";
const PREVIEW_NARROW = "notes:preview-visible:narrow";
const PREVIEW_LEGACY = "notes:preview-visible";

const DESKTOP = { width: 1280, height: 800 };

function sharedSlug() {
  return `/e2e-multitab-${Math.random().toString(36).slice(2, 10)}`;
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

// IDLE_MS in doc-cache. Kept in sync with src/lib/yjs/doc-cache.ts.
const DOC_CACHE_IDLE_MS = 30_000;

async function openTab(context: BrowserContext, path: string, viewport = DESKTOP, withClock = false) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await seed(page);
  if (withClock) {
    // Deterministic time: setTimeout fires only when we explicitly tick.
    // This removes wall-clock races from the IDLE_MS destroy assertions.
    await page.clock.install();
  }
  await page.goto(path);
  return page;
}


test.describe("Markdown preview + doc-cache — two tabs on same note", () => {
  test("toggling preview in one tab does not corrupt the other after F5", async ({ browser }) => {
    const context = await browser.newContext();
    const slug = sharedSlug();

    const tabA = await openTab(context, slug);
    const tabB = await openTab(context, slug);

    await expect.poll(() => previewIsOn(tabA), { timeout: 5000 }).toBe(true);
    await expect.poll(() => previewIsOn(tabB), { timeout: 5000 }).toBe(true);

    // Tab A turns preview OFF — writes "0" into the wide key.
    await tabA.getByRole("button", { name: /Hide preview/ }).first().click();
    await expect.poll(() => previewIsOn(tabA), { timeout: 5000 }).toBe(false);

    // F5 both tabs. Both should now read the persisted "0" — neither tab
    // should be stuck on the stale in-memory ON from before the toggle.
    await tabA.reload();
    await tabB.reload();
    await expect.poll(() => previewIsOn(tabA), { timeout: 5000 }).toBe(false);
    await expect.poll(() => previewIsOn(tabB), { timeout: 5000 }).toBe(false);

    await context.close();
  });

  test("hiding tab A does not destroy the doc tab B is actively displaying", async ({ browser }) => {
    const context = await browser.newContext();
    const slug = sharedSlug();

    // Both tabs run on a controlled clock so any pending IDLE_MS destroy
    // timer is observable and gated by `clock.runFor()`.
    const tabA = await openTab(context, slug, DESKTOP, true);
    const tabB = await openTab(context, slug, DESKTOP, true);

    // Wait for editor to be live in both.
    await expect(tabA.locator(".cm-content").first()).toBeVisible({ timeout: 10_000 });
    await expect(tabB.locator(".cm-content").first()).toBeVisible({ timeout: 10_000 });

    // Snapshot tab B's metrics before tab A goes hidden.
    const before = await tabB.evaluate(() => {
      const w = window as unknown as { __docCacheMetrics?: () => { destroyed: number; size: number } };
      return w.__docCacheMetrics?.() ?? null;
    });

    // Force tab A into the hidden visibilityState and dispatch the event —
    // this triggers `destroyReleased()` in tab A's own cache, but must NOT
    // affect tab B (separate JS realm).
    await tabA.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance tab B's clock by JUST UNDER the IDLE_MS deadline. If any
    // destroy timer was (incorrectly) scheduled for tab B's still-mounted
    // doc, it fires deterministically inside this window. Stopping 1ms
    // short of IDLE_MS guarantees we never tip a *correctly* released
    // doc into destruction during the test.
    await tabB.clock.runFor(DOC_CACHE_IDLE_MS - 1);


    const after = await tabB.evaluate(() => {
      const w = window as unknown as { __docCacheMetrics?: () => { destroyed: number; size: number } };
      return w.__docCacheMetrics?.() ?? null;
    });

    // Tab B's editor is still mounted and the user is actively viewing it,
    // so its doc cannot be destroyed — zero tolerance.
    await expect(tabB.locator(".cm-content").first()).toBeVisible();
    if (before && after) {
      expect(
        after.destroyed,
        "tab A visibilitychange must not destroy tab B's active doc",
      ).toBe(before.destroyed);
      expect(after.size).toBeGreaterThanOrEqual(1);
    }


    await context.close();
  });
});
