// E2E: after the install dialog is closed, there is no path to fire
// the install prompt from the DOM. The Install button is removed from
// the tree (not merely disabled), so keyboard/mouse activation cannot
// call prompt(), and no ghost listeners accumulate.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
    (window as unknown as { __bipCalls: number }).__bipCalls = 0;
  });
});

test("after close: no install prompt fires and no listeners are queued", async ({ page }) => {
  await page.goto("/");

  // Arm BIP so the Install button exists WHILE the dialog is open, then
  // close and confirm it's gone from the DOM afterwards.
  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {
      (window as unknown as { __bipCalls: number }).__bipCalls += 1;
    };
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toBeVisible();

  // Close via ESC. Install button must leave the DOM (not just hide).
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(installBtn).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Try every plausible activation path from OUTSIDE the closed dialog:
  //   - keyboard Enter/Space on the (now-focused) panel trigger
  //   - a fresh document-level Enter and Space
  // None of these must reach a prompt() invocation.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    // Dialog may reopen on Enter/Space (that's the trigger's job) —
    // close it right back and verify NO prompt was fired by the act
    // of opening/closing alone.
    if (await dialog.isVisible()) {
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  }
  const callsAfterActivation = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  expect(callsAfterActivation).toBe(0);

  // Listener-accumulation check: dispatch a NEW BIP after close. If
  // multiple listeners had accumulated, the freshly-dispatched event's
  // prompt() would end up being invoked more than once when we finally
  // click Install. Reopen, click Install once, expect exactly one call.
  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {
      (window as unknown as { __bipCalls: number }).__bipCalls += 1;
    };
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });

  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(installBtn).toBeVisible();
  await installBtn.click();
  await expect(installBtn).toHaveCount(0);

  const finalCalls = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  expect(finalCalls).toBe(1);
});
