// E2E: dispatch BIP, open+close the dialog, then reload the page.
// After reload a fresh BIP must yield exactly ONE install flow — proving
// no listener leaked across the reload boundary.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

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

test("BIP → close dialog → reload → single install flow (no listener leak)", async ({ page }) => {
  await page.goto("/");
  await dispatchBip(page);

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Reload: BIP state should be gone; counter resets via init script.
  await page.reload();
  const callsAfterReload = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  expect(callsAfterReload).toBe(0);

  // Fresh BIP → open → Install → exactly one prompt() invocation.
  await dispatchBip(page);
  const trigger2 = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(trigger2).toBeVisible();
  await trigger2.click();
  const dialog2 = page.getByRole("dialog");
  await expect(dialog2).toBeVisible();

  const installBtn = dialog2.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toBeVisible();
  await installBtn.click();
  await expect(installBtn).toHaveCount(0);

  const calls = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  expect(calls).toBe(1);
});
