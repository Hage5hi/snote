// E2E: simulate `beforeinstallprompt` and assert that the in-dialog
// "Install" button only appears when the event has been captured. Without
// the event (the common Firefox / Safari case), the dialog must fall
// back to the OS install-icon instructions and not render the button.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

test('"Install" button is hidden until beforeinstallprompt fires', async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: new RegExp(dict.en["install.title"]) })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // No BIP event yet → no in-dialog Install button, only guidance text.
  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test('"Install" button appears after dispatching beforeinstallprompt', async ({ page }) => {
  await page.goto("/");
  // Synthesize a BeforeInstallPromptEvent that the component listens for.
  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {};
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });

  await page
    .getByRole("button", { name: new RegExp(dict.en["install.title"]) })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toBeVisible();
});
