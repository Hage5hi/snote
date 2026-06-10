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
  test("Tab cycles focus inside the dialog and never escapes the #root/main/body container", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Inject extra tabbable decoys OUTSIDE the (future) dialog: if the trap
    // ever regresses, Tab would land on these — making the failure obvious.
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "e2e-focus-decoys";
      host.style.cssText = "position:fixed;left:-9999px;top:0;";
      for (let i = 0; i < 3; i++) {
        const b = document.createElement("button");
        b.textContent = `decoy-${i}`;
        b.setAttribute("data-e2e-decoy", String(i));
        host.appendChild(b);
      }
      document.body.appendChild(host);
    });

    await openPalette(page);
    await expect.poll(() => activeIsInsideDialog(page), { timeout: 2000 }).toBe(true);

    async function snapshotActive() {
      return page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return {
          isBody: el === document.body,
          isDecoy: !!el?.hasAttribute("data-e2e-decoy"),
          inContainer:
            !!el && !!document.querySelector("#root, main, body")?.contains(el),
        };
      });
    }

    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const s = await snapshotActive();
      const inside = await activeIsInsideDialog(page);
      expect(s.isBody, `Tab #${i + 1} landed on <body>`).toBe(false);
      expect(s.isDecoy, `Tab #${i + 1} escaped to background decoy`).toBe(false);
      expect(s.inContainer, `Tab #${i + 1} left #root/main/body container`).toBe(true);
      expect(inside, `Tab #${i + 1} let focus escape the dialog`).toBe(true);
    }

    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Shift+Tab");
      const s = await snapshotActive();
      const inside = await activeIsInsideDialog(page);
      expect(s.isBody, `Shift+Tab #${i + 1} landed on <body>`).toBe(false);
      expect(s.isDecoy, `Shift+Tab #${i + 1} escaped to background decoy`).toBe(false);
      expect(s.inContainer, `Shift+Tab #${i + 1} left #root/main/body container`).toBe(true);
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

  test("mouse-focused trigger → ⌘+K → Tab/Shift+Tab cycles → Escape restores focus to that trigger", async ({ page }) => {
    // Scenario: user first focuses the trigger with a real mouse click
    // (not keyboard Tab), then opens the palette, cycles focus many times
    // with Tab/Shift+Tab, and presses Escape. The palette only opens via
    // ⌘+K — there's no mouse-driven opener — so this test pins the
    // "mouse-focused then keyboard-opened" flow, which is the closest
    // analog and the one that previously broke focus restoration.
    await seed(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Install decoys so a focus escape after Escape would be visible.
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "e2e-focus-decoys-mouse";
      host.style.cssText = "position:fixed;left:-9999px;top:0;";
      for (let i = 0; i < 3; i++) {
        const b = document.createElement("button");
        b.textContent = `decoy-${i}`;
        b.setAttribute("data-e2e-decoy", String(i));
        host.appendChild(b);
      }
      document.body.appendChild(host);
    });

    // Tag a real on-page focusable, then click it with the mouse so the
    // browser records a real pointer-driven focus (not a programmatic one).
    const triggerSel = await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>("button, a, [tabindex]");
      if (!btn) throw new Error("no focusable trigger on Home");
      btn.setAttribute("data-test-trigger", "mouse");
      btn.setAttribute("data-mouse-trigger", "1");
      return "[data-mouse-trigger='1']";
    });
    await page.locator(triggerSel).click();
    const focusedViaMouse = await page.evaluate(
      () => document.activeElement?.getAttribute("data-mouse-trigger") === "1",
    );
    expect(focusedViaMouse, "trigger did not receive focus from mouse click").toBe(true);

    await openPalette(page);
    await expect.poll(() => activeIsInsideDialog(page), { timeout: 2000 }).toBe(true);

    for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
    for (let i = 0; i < 10; i++) await page.keyboard.press("Shift+Tab");

    // Focus must still be inside the dialog throughout the cycling.
    expect(await activeIsInsideDialog(page), "focus escaped dialog mid-cycle").toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.locator("[cmdk-root], [role='dialog']")).toBeHidden({ timeout: 2000 });

    const post = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        triggerRestored: el?.getAttribute("data-mouse-trigger") === "1",
        isBody: el === document.body,
        isDecoy: !!el?.hasAttribute("data-e2e-decoy"),
        inMain: !!el && !!document.querySelector("#root, main, body")?.contains(el),
        tag: el?.tagName ?? null,
      };
    });
    expect(post.isBody, "focus fell back to <body> after Escape (mouse-opened)").toBe(false);
    expect(post.isDecoy, "focus landed on background decoy after Escape (mouse-opened)").toBe(false);
    expect(post.inMain, "focus left container after Escape (mouse-opened)").toBe(true);
    expect(
      post.triggerRestored,
      `mouse-focused trigger not restored after Escape (active=${post.tag})`,
    ).toBe(true);
  });
});


