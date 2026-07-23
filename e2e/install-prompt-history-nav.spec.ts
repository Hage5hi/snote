// E2E: browser back/forward (history) navigation must not leak BIP
// listeners or corrupt the focus trap. After going / → /privacy →
// back (popstate) → forward → back, the InstallPrompt panel must
// still work: BIP fires exactly once, dialog opens, focus stays
// trapped, ESC closes cleanly.
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

test("back/forward history navigation preserves InstallPrompt state and focus trap", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: new RegExp(dict.en["install.title"]) }),
  ).toBeVisible();

  // Push /privacy onto history, then bounce back-forward-back.
  await page.goto("/privacy");
  await expect(page).toHaveURL(/\/privacy$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(trigger).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/privacy$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(trigger).toBeVisible();

  // A single BIP after all this history churn — must yield exactly one flow.
  await dispatchBip(page);

  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Focus trap must still be intact after history navigation.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      () => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    );
    expect(inside, `focus escaped on Tab #${i + 1}`).toBe(true);
  }

  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toBeVisible();
  await installBtn.click();
  await expect(installBtn).toHaveCount(0);

  const calls = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  expect(calls).toBe(1);

  // ESC still closes cleanly and returns focus to the trigger.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
