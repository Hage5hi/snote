// E2E: after many Tab/Shift+Tab presses inside the CommandPalette, pressing
// Escape must return focus to the exact element that opened the dialog
// (tagged via `data-test-trigger`), never to a background decoy and never to
// <body>. Re-runs across multiple open/close cycles to be sure focus restore
// is stable, not a one-shot lucky pass.
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

async function installDecoysAndTagTrigger(page: Page) {
  await page.evaluate(() => {
    if (!document.getElementById("e2e-focus-decoys")) {
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
    }
    const btn = document.querySelector<HTMLElement>("button, a, [tabindex]");
    if (!btn) throw new Error("no focusable trigger found");
    btn.setAttribute("data-test-trigger", "1");
    btn.focus();
  });
}

async function openPalette(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  });
  await expect(page.locator("[cmdk-root], [role='dialog']")).toBeVisible({ timeout: 5000 });
}

test.describe("CommandPalette — Escape after many Tab/Shift+Tab restores trigger focus", () => {
  test("focus returns to original trigger after 12 Tab + 12 Shift+Tab, across 3 cycles", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    for (let cycle = 1; cycle <= 3; cycle++) {
      await installDecoysAndTagTrigger(page);
      const triggerActiveBefore = await page.evaluate(
        () => document.activeElement?.getAttribute("data-test-trigger") === "1",
      );
      expect(triggerActiveBefore, `cycle ${cycle}: trigger not focused pre-open`).toBe(true);

      await openPalette(page);

      for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
      for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+Tab");

      await page.keyboard.press("Escape");
      await expect(page.locator("[cmdk-root], [role='dialog']")).toBeHidden({ timeout: 2000 });

      const post = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return {
          triggerRestored: el?.getAttribute("data-test-trigger") === "1",
          isBody: el === document.body,
          isDecoy: !!el?.hasAttribute("data-e2e-decoy"),
          inMain: !!el && !!document.querySelector("#root, main, body")?.contains(el),
          tag: el?.tagName ?? null,
        };
      });
      expect(post.isBody, `cycle ${cycle}: focus on <body> after Escape`).toBe(false);
      expect(post.isDecoy, `cycle ${cycle}: focus on background decoy after Escape`).toBe(false);
      expect(post.inMain, `cycle ${cycle}: focus left container after Escape`).toBe(true);
      expect(
        post.triggerRestored,
        `cycle ${cycle}: trigger focus not restored (active=${post.tag})`,
      ).toBe(true);
    }
  });
});
