// E2E: from the LAST focusable element in the install-as-app dialog,
// Shift+Tab backward through the whole set — plus one extra — to force
// a wrap. Focus must never escape the dialog's focus trap.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

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

test("Shift+Tab from last focusable stays trapped inside dialog", async ({ page }) => {
  await page.goto("/");

  // BIP so Install button is part of the focusable set.
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

  // Move focus to the LAST focusable inside the dialog directly.
  await dialog.evaluate((el) => {
    const sel = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const list = el.querySelectorAll<HTMLElement>(sel);
    list[list.length - 1]?.focus();
  });
  expect(await focusInsideDialog(page)).toBe(true);

  // Shift+Tab backward through the whole set + 1 extra to force wrap.
  for (let i = 0; i < focusableCount + 1; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await focusInsideDialog(page),
      `Shift+Tab #${i + 1} escaped focus trap`,
    ).toBe(true);
  }
});
