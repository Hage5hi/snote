// E2E: a full-page reload resets the captured `beforeinstallprompt`
// event (the browser does not re-dispatch on its own), so after reload
// the Install button must be hidden again and the dialog must still
// behave correctly. Re-dispatching BIP post-reload should restore the
// Install button without any stale state from before the reload.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

test("BIP state resets on reload and recovers when re-dispatched", async ({ page }) => {
  await page.goto("/");

  // 1. Fire BIP and confirm the Install button shows.
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
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // 2. Reload the page — the captured BIP reference is cleared.
  await page.reload();
  await page
    .getByRole("button", { name: new RegExp(dict.en["install.title"]) })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Install button must NOT be present after reload (no live BIP).
  await expect(
    dialog.getByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
  ).toHaveCount(0);
  // Dialog lock semantics still hold.
  await expect(dialog.getByTestId("dialog-close")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // 3. Re-dispatch BIP after reload — button must reappear cleanly.
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
  dialog = page.getByRole("dialog");
  const btn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(btn).toHaveCount(1);
  await expect(btn).toBeVisible();
});
