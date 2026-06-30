// E2E: dispatching multiple `beforeinstallprompt` events must not stack —
// only the latest event drives the in-dialog "Install" button, and the
// button must render exactly once regardless of how many events fired.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

test("multiple beforeinstallprompt dispatches yield exactly one Install button", async ({ page }) => {
  await page.goto("/");

  // Fire the event three times back-to-back. The component should always
  // hold a reference to the latest event (last write wins) and the UI
  // should remain idempotent.
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      const ev = new Event("beforeinstallprompt") as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
        _id: number;
      };
      ev.prompt = async () => {};
      ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
      ev._id = i;
      window.dispatchEvent(ev);
    }
  });

  await page
    .getByRole("button", { name: new RegExp(dict.en["install.title"]) })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  // Exactly one button, not three.
  await expect(installBtn).toHaveCount(1);
  await expect(installBtn).toBeVisible();
});
