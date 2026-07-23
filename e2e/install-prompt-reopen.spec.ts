// E2E: closing the install-as-app dialog via ESC and then via clicking
// the Install button (which clears the BIP reference but does NOT close
// the dialog) must leave the panel state correct on reopen. The focus
// trap must still hold, and the Install button visibility must match
// whether a live BIP event is currently held.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

async function dispatchBip(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {};
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });
}

async function focusInsideDialog(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return !!dlg && !!document.activeElement && dlg.contains(document.activeElement);
  });
}

test("ESC close → reopen preserves Install button and focus trap", async ({ page }) => {
  await page.goto("/");
  await dispatchBip(page);

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });

  // First open + ESC close.
  await trigger.click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Reopen — Install button should still be present (BIP still held).
  await trigger.click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
  ).toBeVisible();

  // Focus trap still holds after reopen.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInsideDialog(page), `Tab #${i + 1} escaped`).toBe(true);
  }
});

test("Install click clears BIP → reopen shows no Install button, trap holds", async ({ page }) => {
  await page.goto("/");
  await dispatchBip(page);

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toBeVisible();

  // Clicking Install consumes the BIP event; component sets bipEvent=null.
  await installBtn.click();
  await expect(installBtn).toHaveCount(0);

  // Dialog stays open (no auto-close on install). Close via ESC then reopen.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await trigger.click();
  const dialog2 = page.getByRole("dialog");
  await expect(dialog2).toBeVisible();

  // BIP is consumed → Install button must NOT come back.
  await expect(
    dialog2.getByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
  ).toHaveCount(0);

  // Focus trap still holds on the reopened (button-less) dialog.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInsideDialog(page), `Tab #${i + 1} escaped`).toBe(true);
  }
});
