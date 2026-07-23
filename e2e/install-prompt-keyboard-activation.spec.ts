// E2E: keyboard activation of the Install button.
// - Before BIP: Install button must NOT exist inside the dialog, so
//   Enter/Space cannot possibly trigger a stray prompt() call.
// - After BIP: focusing the Install button and pressing Enter (then
//   reopening and pressing Space) must trigger prompt() exactly once
//   per activation — and never fire when the button is absent.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
    (window as unknown as { __bipCalls: number }).__bipCalls = 0;
  });
});

function dispatchBip(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
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
}

test("Install button: hidden without BIP, Enter/Space activate exactly once with BIP", async ({ page }) => {
  await page.goto("/");

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // No BIP yet → Install button must not be in the dialog.
  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toHaveCount(0);

  // Tabbing inside the dialog must never land on the (nonexistent)
  // Install button and must never invoke prompt().
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
  }
  let calls = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  expect(calls).toBe(0);

  // Close and dispatch BIP.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await dispatchBip(page);

  // Reopen and activate Install with Enter.
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(installBtn).toBeVisible();
  await installBtn.focus();
  await expect(installBtn).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(installBtn).toHaveCount(0);

  calls = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  expect(calls).toBe(1);

  // Dispatch a second BIP and activate via Space this time.
  await dispatchBip(page);
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(installBtn).toBeVisible();
  await installBtn.focus();
  await page.keyboard.press("Space");
  await expect(installBtn).toHaveCount(0);

  calls = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  expect(calls).toBe(2);
});
