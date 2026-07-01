// E2E: two distinct BIP events with distinct `prompt()` instances are
// dispatched. Clicking Install must invoke ONLY the latest event's
// prompt — the earlier one must never fire.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
    (window as unknown as { __firstCalled: boolean; __secondCalled: boolean }).__firstCalled = false;
    (window as unknown as { __firstCalled: boolean; __secondCalled: boolean }).__secondCalled = false;
  });
});

test("Install uses only the latest BIP prompt instance", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    const first = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    first.prompt = async () => {
      (window as unknown as { __firstCalled: boolean }).__firstCalled = true;
    };
    first.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(first);

    const second = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    second.prompt = async () => {
      (window as unknown as { __secondCalled: boolean }).__secondCalled = true;
    };
    second.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(second);
  });

  await page
    .getByRole("button", { name: new RegExp(dict.en["install.title"]) })
    .click();
  const dialog = page.getByRole("dialog");
  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await installBtn.click();
  await expect(installBtn).toHaveCount(0);

  const state = await page.evaluate(() => ({
    first: (window as unknown as { __firstCalled: boolean }).__firstCalled,
    second: (window as unknown as { __secondCalled: boolean }).__secondCalled,
  }));
  expect(state.second).toBe(true);
  expect(state.first).toBe(false);
});
