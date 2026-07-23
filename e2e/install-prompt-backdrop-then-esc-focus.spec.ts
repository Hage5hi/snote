// E2E: the install-as-app dialog is intentionally NOT dismissible via
// backdrop / outside click (onPointerDownOutside + onInteractOutside
// both call preventDefault). This test documents that contract AND
// verifies that when the dialog IS closed — via ESC, the sole close
// affordance — focus returns to the exact trigger element that opened
// it and the focus trap is fully released (Tab can move to a sibling
// focusable element outside the closed dialog).
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

test("backdrop click keeps dialog open; ESC restores focus + releases trap", async ({ page }) => {
  await page.goto("/");

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Attempt to close via backdrop click. Product contract prevents it,
  // so the dialog must remain open and the focus trap must still hold.
  const overlay = page
    .locator('[data-radix-dialog-overlay], [data-state="open"].fixed.inset-0')
    .first();
  if (await overlay.count()) {
    await overlay.click({ position: { x: 5, y: 5 }, force: true });
  } else {
    await page.mouse.click(5, 5);
  }
  await expect(dialog).toBeVisible();
  const trappedAfterBackdrop = await page.evaluate(
    () => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement),
  );
  expect(trappedAfterBackdrop).toBe(true);

  // ESC is the actual close affordance — this must return focus to the
  // original trigger element.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Focus trap must now be released: Tab is free to reach a focusable
  // element outside the (closed) dialog. The extension trigger sits in
  // the same panel and is a stable next-focusable target.
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
    expect(stuck, `Tab #${i + 1}: focus trapped inside closed dialog`).toBe(false);
    if (await extTrigger.evaluate((el) => el === document.activeElement)) {
      landed = true;
      break;
    }
  }
  expect(landed, "Tab never reached a focusable element outside the closed dialog").toBe(true);
});
