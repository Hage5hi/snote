// E2E: open dialog, ESC-close, then navigate back and forward through
// history. The dialog must stay closed across the churn and the Install
// button must remain in a consistent state (single, visible, clickable
// once a fresh BIP arrives — no accumulated flows).
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

test("ESC → back → forward keeps dialog closed and Install button consistent", async ({ page }) => {
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
  await expect(trigger).toBeFocused();

  // Push /privacy, then back and forward.
  await page.goto("/privacy");
  await expect(page).toHaveURL(/\/privacy$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  const triggerAfterBack = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(triggerAfterBack).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goForward();
  await expect(page).toHaveURL(/\/privacy$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  const finalTrigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(finalTrigger).toHaveCount(1);
  await expect(finalTrigger).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Fresh BIP → dialog opens cleanly, Install fires exactly once.
  await dispatchBip(page);
  await finalTrigger.click();
  const finalDialog = page.getByRole("dialog");
  await expect(finalDialog).toBeVisible();

  const installBtn = finalDialog.getByRole("button", {
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
