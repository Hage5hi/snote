// E2E: when localStorage writes throw QuotaExceededError on every set, the
// preview-visible hook must
//   (a) not throw at render or on toggle,
//   (b) fall back to the viewport-appropriate default,
//   (c) run the legacy migration at most once across reloads of this realm
//       (the one-shot guard is module-level, so each F5 = new realm = 1
//       attempt MAX). We assert the per-session counter via the dev metric
//       `window.__previewVisibleMetrics`.
import { test, expect, type Page } from "@playwright/test";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";
const PREVIEW_WIDE = "notes:preview-visible:wide";
const PREVIEW_NARROW = "notes:preview-visible:narrow";
const PREVIEW_LEGACY = "notes:preview-visible";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 800 };

function notePath() {
  return `/e2e-quota-${Math.random().toString(36).slice(2, 10)}`;
}

async function seedWithQuotaTrap(page: Page) {
  // Seed valid lang flags FIRST (before the trap is armed), then wrap
  // setItem so every subsequent write throws QuotaExceededError. We also
  // pre-seed a legacy key on the wide path to exercise the migration code
  // path, which itself does a setItem and must swallow the quota error.
  await page.addInitScript(
    ({ lang, ip, w, n, l }) => {
      try {
        localStorage.setItem(lang, "en");
        localStorage.setItem(ip, "1");
        localStorage.removeItem(w);
        localStorage.removeItem(n);
        localStorage.setItem(l, "1"); // legacy → exercises migration write
      } catch {
        /* ignore */
      }
      const proto = Object.getPrototypeOf(localStorage) as Storage;
      const orig = proto.setItem.bind(localStorage);
      let armed = false;
      // Arm on next microtask so the seeds above commit.
      queueMicrotask(() => { armed = true; });
      proto.setItem = function (k: string, v: string) {
        if (armed) {
          const err = new Error("QuotaExceededError");
          err.name = "QuotaExceededError";
          throw err;
        }
        return orig(k, v);
      };
    },
    { lang: LANG_KEY, ip: IP_DETECTED_KEY, w: PREVIEW_WIDE, n: PREVIEW_NARROW, l: PREVIEW_LEGACY },
  );
}

async function previewIsOn(page: Page): Promise<boolean> {
  const hide = page.getByRole("button", { name: /Hide preview|Back to editor/ });
  return (await hide.count()) > 0;
}

async function previewMetrics(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __previewVisibleMetrics?: () => { migrationAttempted: boolean; migrationRan: number };
    };
    return w.__previewVisibleMetrics?.() ?? null;
  });
}

test.describe("Markdown preview — localStorage quota exceeded", () => {
  test("desktop: fallback ON, toggle works in-memory, no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.setViewportSize(DESKTOP);
    await seedWithQuotaTrap(page);
    await page.goto(notePath());

    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    // Toggle a few times — each write would throw, the hook must swallow it.
    const hide = page.getByRole("button", { name: /Hide preview/ });
    await hide.first().click();
    await expect.poll(() => previewIsOn(page), { timeout: 3000 }).toBe(false);

    const show = page.getByRole("button", { name: /Show preview|Show markdown preview/i });
    if (await show.count()) await show.first().click();

    expect(errors, `unexpected pageerror under quota: ${errors.join("\n")}`).toEqual([]);
  });

  test("mobile: fallback OFF under quota and survives F5", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.setViewportSize(MOBILE);
    await seedWithQuotaTrap(page);
    await page.goto(notePath());

    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);

    await page.reload();
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(false);

    expect(errors, `unexpected pageerror under quota: ${errors.join("\n")}`).toEqual([]);
  });

  test("migration runs at most once per realm under quota", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seedWithQuotaTrap(page);
    await page.goto(notePath());

    // Wait for the hook to mount.
    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    const m = await previewMetrics(page);
    // Metric only available in dev builds; only assert when present.
    if (m) {
      expect(m.migrationAttempted).toBe(true);
      // The legacy key was seeded → migration ran once. The quota-throwing
      // write inside the migration must NOT increment the counter twice or
      // re-enter the one-shot guard.
      expect(m.migrationRan).toBeLessThanOrEqual(1);
    }
  });

  test("legacy key is preserved across migration + viewport toggle never throws", async ({ page }) => {
    // User data in localStorage is sacred: the migration must mirror the
    // legacy value into the wide key but NEVER delete the legacy key, even
    // when subsequent writes throw QuotaExceededError. Then toggling the
    // preview pane across desktop ↔ mobile must keep working (in-memory)
    // without emitting pageerrors despite every setItem throwing.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.setViewportSize(DESKTOP);
    await seedWithQuotaTrap(page);
    await page.goto(notePath());

    await expect.poll(() => previewIsOn(page), { timeout: 5000 }).toBe(true);

    // Legacy key must still be present after the migration ran under quota.
    const legacyAfterMigration = await page.evaluate(
      (k) => localStorage.getItem(k),
      PREVIEW_LEGACY,
    );
    expect(legacyAfterMigration, "migration deleted legacy key under quota").toBe("1");

    // Toggle on desktop (write would throw → must be swallowed).
    await page.getByRole("button", { name: /Hide preview/ }).first().click();
    await expect.poll(() => previewIsOn(page), { timeout: 3000 }).toBe(false);

    // Switch to mobile viewport → fallback OFF by viewport, no carryover.
    await page.setViewportSize(MOBILE);
    await expect.poll(() => previewIsOn(page), { timeout: 3000 }).toBe(false);

    // Back to desktop → in-memory wide state still OFF (set just above).
    await page.setViewportSize(DESKTOP);
    await expect.poll(() => previewIsOn(page), { timeout: 3000 }).toBe(false);

    // Legacy key still untouched after all the toggling + resizes.
    const legacyFinal = await page.evaluate(
      (k) => localStorage.getItem(k),
      PREVIEW_LEGACY,
    );
    expect(legacyFinal, "legacy key was mutated by toggle/resize under quota").toBe("1");

    expect(errors, `unexpected pageerror under quota: ${errors.join("\n")}`).toEqual([]);
  });
});
