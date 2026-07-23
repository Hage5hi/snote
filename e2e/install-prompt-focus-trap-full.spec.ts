// E2E: exhaustive focus-trap check for the install-as-app dialog. We
// enumerate every focusable element inside the dialog and Tab/Shift-Tab
// across the full count + a few extra cycles to confirm focus never
// escapes to the document body or to elements outside the dialog.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

async function focusInsideDialog(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const active = document.activeElement;
    return !!dlg && !!active && dlg.contains(active);
  });
}

test("focus stays trapped across every focusable element (Tab + Shift+Tab)", async ({ page }) => {
  await page.goto("/");

  // Simulate BIP so the Install button is part of the focusable set —
  // we want to cover the maximum surface of focusables.
  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {};
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });

  await page
    .getByRole("button", { name: new RegExp(dict.en["install.title"]) })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const focusableCount = await dialog.evaluate((el) => {
    const sel = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    return el.querySelectorAll(sel).length;
  });
  expect(focusableCount).toBeGreaterThan(0);

  // Tab forward through 2x the count to guarantee at least one wrap.
  for (let i = 0; i < focusableCount * 2 + 2; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInsideDialog(page), `Tab #${i + 1} escaped trap`).toBe(true);
  }

  // Then Shift+Tab backward the same amount.
  for (let i = 0; i < focusableCount * 2 + 2; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusInsideDialog(page), `Shift+Tab #${i + 1} escaped trap`).toBe(true);
  }
});
