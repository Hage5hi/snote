// E2E: after closing the install-as-app dialog with ESC, the in-dialog
// "Install" button is hidden (dialog gone). After navigating away and
// back with history, dispatching BIP once must yield exactly ONE visible
// Install button in the reopened dialog — no accumulation across
// unmount/remount cycles.
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

test("Install hidden after ESC; after back-nav appears exactly once", async ({ page }) => {
  await page.goto("/");
  const triggerName = new RegExp(dict.en["install.title"]);
  const trigger = page.getByRole("button", { name: triggerName });
  await expect(trigger).toBeVisible();

  // Fire BIP, open dialog, verify Install visible, then ESC.
  await dispatchBip(page);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Once dialog closed the Install button must be gone from DOM.
  await expect(
    page.getByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
  ).toHaveCount(0);

  // Navigate away then back via history.
  await page.goto("/privacy");
  await expect(page).toHaveURL(/\/privacy$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: triggerName })).toBeVisible();

  // Fire BIP once on the remounted panel.
  await dispatchBip(page);
  await page.getByRole("button", { name: triggerName }).click();
  const dialog2 = page.getByRole("dialog");
  await expect(dialog2).toBeVisible();

  // Exactly one Install button — no duplicate/stacked renders.
  const installBtn2 = dialog2.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn2).toHaveCount(1);
  await expect(installBtn2).toBeVisible();

  // Clicking triggers exactly one prompt call.
  await installBtn2.click();
  const calls = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  expect(calls).toBe(1);
});
