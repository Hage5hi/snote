// E2E: Tab to the LAST focusable element in the install-as-app dialog,
// then press Shift+Tab repeatedly to walk backward through the entire
// focusable set and past the first element. Focus must never escape
// the dialog (i.e. must not land on document.body or on elements
// outside the dialog container).
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

test("Tab to last focusable then Shift+Tab keeps focus inside trap", async ({ page }) => {
  await page.goto("/");

  // BIP so Install is part of the focusable set (maximal surface).
  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {};
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
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

  // Tab forward to reach the LAST focusable element.
  for (let i = 0; i < focusableCount; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInsideDialog(page), `Tab #${i + 1} escaped trap`).toBe(true);
  }

  // Shift+Tab backward past the first element (should wrap) — count
  // is (focusables + 2) to guarantee at least one wrap boundary.
  for (let i = 0; i < focusableCount + 2; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusInsideDialog(page), `Shift+Tab #${i + 1} escaped trap`).toBe(true);
  }
});
