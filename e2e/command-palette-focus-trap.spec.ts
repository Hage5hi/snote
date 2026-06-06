// E2E: when the CommandPalette is open, focus must stay trapped inside the
// dialog (Tab / Shift+Tab cycle, never escape to <body> or outer chrome) and
// Escape must close it and return focus to the page.
//
// We rely on the focus trap that ships with shadcn's `CommandDialog` (Radix
// `Dialog`), so the spec is a guardrail against a future refactor (e.g.,
// swapping the dialog for a plain popover) silently dropping a11y.
import { test, expect, type Page } from "@playwright/test";

const LANG_KEY = "lang";
const IP_DETECTED_KEY = "lang.ip_detected";

async function seed(page: Page) {
  await page.addInitScript(
    ({ lang, ip }) => {
      localStorage.setItem(lang, "en");
      localStorage.setItem(ip, "1");
    },
    { lang: LANG_KEY, ip: IP_DETECTED_KEY },
  );
}

async function openPalette(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  });
  await expect(page.locator("[cmdk-root], [role='dialog']")).toBeVisible({ timeout: 5000 });
}

async function activeIsInsideDialog(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog']");
    const el = document.activeElement;
    if (!dialog || !el || el === document.body) return false;
    return dialog.contains(el);
  });
}

test.describe("CommandPalette — focus trap & Escape", () => {
  test("Tab cycles focus inside the dialog and never escapes to body", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await openPalette(page);

    // After opening, focus should already be inside the dialog (input).
    await expect.poll(() => activeIsInsideDialog(page), { timeout: 2000 }).toBe(true);

    // Press Tab a generous number of times — focus must never land on <body>
    // or outside the dialog container.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const inside = await activeIsInsideDialog(page);
      expect(inside, `Tab #${i + 1} let focus escape the dialog`).toBe(true);
    }

    // Shift+Tab the other direction too.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Shift+Tab");
      const inside = await activeIsInsideDialog(page);
      expect(inside, `Shift+Tab #${i + 1} let focus escape the dialog`).toBe(true);
    }
  });

  test("Escape returns focus to the original trigger and never escapes the container", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Tag a real, focusable element on the page as the "trigger". Radix
    // Dialog stores `document.activeElement` at open time and restores it
    // on close, so we tag whatever we focus, open the palette, then
    // assert the same element is active again post-Escape.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>("button, a, [tabindex]");
      if (!btn) throw new Error("no focusable trigger found on Home");
      btn.setAttribute("data-test-trigger", "1");
      btn.focus();
    });
    const triggerActiveBefore = await page.evaluate(() =>
      document.activeElement?.getAttribute("data-test-trigger") === "1",
    );
    expect(triggerActiveBefore, "trigger did not receive focus pre-open").toBe(true);

    await openPalette(page);
    // Sanity: focus moved into the dialog.
    await expect.poll(() => activeIsInsideDialog(page), { timeout: 2000 }).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.locator("[cmdk-root], [role='dialog']")).toBeHidden({ timeout: 2000 });

    // Focus must come back to the exact element that opened the dialog,
    // never to <body>, never to a detached node, never to anything outside
    // the page's main container.
    const post = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        triggerRestored: el?.getAttribute("data-test-trigger") === "1",
        isBody: el === document.body,
        inMain: !!el && !!document.querySelector("#root, main, body")?.contains(el),
        tag: el?.tagName ?? null,
      };
    });
    expect(post.isBody, "focus fell back to <body> after Escape").toBe(false);
    expect(post.inMain, "focus left the expected container after Escape").toBe(true);
    expect(post.triggerRestored, `focus did not return to original trigger (active=${post.tag})`).toBe(true);
  });
});

