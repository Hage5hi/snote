// E2E: after a backdrop click attempt (no-op — dialog uses
// preventDefault on outside interactions), pressing Tab and Shift+Tab
// repeatedly must keep focus wrapping inside the dialog and never
// escape to the underlying page.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";
import { expectFocusInsideDialog, resetPromptSpy } from "./helpers/install-prompt";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

test("Tab/Shift+Tab cycle after backdrop click stays inside focus trap", async ({ page }, testInfo) => {
  await page.goto("/");
  await resetPromptSpy(page);

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
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Attempt outside dismissal (product prevents it).
  await page.mouse.click(5, 5);
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

  // Two full forward cycles + two full backward cycles → guaranteed wraps.
  const forward = focusableCount * 2 + 2;
  for (let i = 0; i < forward; i++) {
    await page.keyboard.press("Tab");
    await expectFocusInsideDialog(page, testInfo, `tab-${i + 1}`);
  }
  for (let i = 0; i < forward; i++) {
    await page.keyboard.press("Shift+Tab");
    await expectFocusInsideDialog(page, testInfo, `shiftTab-${i + 1}`);
  }
});
