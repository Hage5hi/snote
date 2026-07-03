// E2E: after ESC-closing the install-as-app dialog, focus must return
// to the trigger button that opened it, AND the focus trap must be
// fully released so keyboard focus can move freely to elements OUTSIDE
// the (now-closed) dialog.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

test("ESC returns focus to trigger and releases focus trap", async ({ page }) => {
  await page.goto("/");

  // BIP so Install is a real focusable target inside the dialog.
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

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // 1) Focus returned to the exact element that opened the dialog.
  await expect(trigger).toBeFocused();

  // 2) Focus trap is released — Tab must be free to move focus to a
  //    different focusable element (the extension trigger sits right
  //    after the install trigger in the same panel).
  const extTrigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.ext_title"]),
  });
  await expect(extTrigger).toBeVisible();

  await page.keyboard.press("Tab");
  // Some elements may be tabbed between the two triggers depending on
  // ambient UI; press up to a small bounded number of Tabs until focus
  // lands on the extension trigger to prove the trap is released.
  let landed = false;
  for (let i = 0; i < 12; i++) {
    const isExt = await extTrigger.evaluate((el) => el === document.activeElement);
    if (isExt) {
      landed = true;
      break;
    }
    // Also assert we are NOT stuck back inside the (closed) dialog.
    const stuckInsideDialog = await page.evaluate(
      () => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    );
    expect(stuckInsideDialog, `Tab #${i + 1}: focus trapped in closed dialog`).toBe(false);
    await page.keyboard.press("Tab");
  }
  expect(landed, "Tab never reached a focusable element outside the (closed) dialog").toBe(true);
});
