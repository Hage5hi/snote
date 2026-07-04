// E2E: after attempting to dismiss the install dialog by clicking the
// backdrop (which is a no-op — dialog uses preventDefault on outside
// interactions), Shift+Tab cycles must stay inside the focus trap and
// never escape to the underlying page.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";
import { expectFocusInsideDialog, resetPromptSpy } from "./helpers/install-prompt";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});


test("Shift+Tab after backdrop click never escapes focus trap", async ({ page }, testInfo) => {
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

  // Try to close via backdrop click (a corner outside the panel).
  // Product intentionally prevents this — dialog must remain open.
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

  // Shift+Tab through the full set + 2 extra to force at least one wrap.
  for (let i = 0; i < focusableCount + 2; i++) {
    await page.keyboard.press("Shift+Tab");
    await expectFocusInsideDialog(page, testInfo, `shiftTab-${i + 1}`);
  }
});

