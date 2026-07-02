// E2E: rapid ESC-then-back sequence. Open the install-as-app dialog,
// press ESC to close, then IMMEDIATELY navigate back through history
// (with no intermediate awaits). Dialog + Install button state must
// stay consistent and the BIP listener must not accumulate — a single
// BIP after the sequence yields exactly one install flow.
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

test("ESC-then-immediate-back keeps dialog/Install state consistent", async ({ page }) => {
  // Establish a history entry before "/" so goBack has somewhere to go.
  await page.goto("/privacy");
  await page.goto("/");

  const triggerName = new RegExp(dict.en["install.title"]);
  const trigger = page.getByRole("button", { name: triggerName });
  await expect(trigger).toBeVisible();

  await dispatchBip(page);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Rapid: ESC then back — no await between the two actions.
  await Promise.all([
    page.waitForURL(/\/privacy$/),
    (async () => {
      await page.keyboard.press("Escape");
      await page.goBack();
    })(),
  ]);
  await expect(page).toHaveURL(/\/privacy$/);

  // Forward back to "/" — panel remounts fresh.
  await page.goForward();
  await expect(page).toHaveURL(/\/$/);
  const triggerAfter = page.getByRole("button", { name: triggerName });
  await expect(triggerAfter).toBeVisible();

  // No lingering dialog from before the navigation.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // No stale Install button in the DOM either.
  await expect(
    page.getByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
  ).toHaveCount(0);

  // Fire one BIP on the remounted panel and complete the install flow.
  await dispatchBip(page);
  await triggerAfter.click();
  const dialog2 = page.getByRole("dialog");
  await expect(dialog2).toBeVisible();
  const installBtn = dialog2.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toHaveCount(1);
  await installBtn.click();

  const calls = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  // Exactly one flow — proves the pre-navigation listener was cleaned
  // up and did NOT double-fire alongside the fresh remount listener.
  expect(calls).toBe(1);
});
