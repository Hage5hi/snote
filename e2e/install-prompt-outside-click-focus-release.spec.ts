// E2E: after attempting to dismiss the dialog via outside click
// (which is a no-op — product uses preventDefault), ESC closes the
// dialog; focus must return to the exact trigger that opened it and
// the focus trap must be fully released so Tab can move to elements
// outside the closed dialog.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

test("outside click then close restores focus and releases trap", async ({ page }) => {
  await page.goto("/");

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Outside click — product prevents dismissal.
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();

  // Close via ESC (the sole close affordance).
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Focus returned to the exact trigger.
  await expect(trigger).toBeFocused();

  // Focus trap released — Tab reaches a sibling focusable outside.
  const extTrigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.ext_title"]),
  });
  await expect(extTrigger).toBeVisible();
  let landed = false;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const stuck = await page.evaluate(
      () => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    );
    expect(stuck, `Tab #${i + 1}: focus trapped in closed dialog`).toBe(false);
    if (await extTrigger.evaluate((el) => el === document.activeElement)) {
      landed = true;
      break;
    }
  }
  expect(landed, "Tab never reached a focusable element outside the closed dialog").toBe(true);
});
