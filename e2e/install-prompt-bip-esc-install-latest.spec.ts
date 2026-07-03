// E2E: dispatch two distinct BIP events with distinct prompt() instances,
// close the dialog with ESC, reopen and click Install — only the LATEST
// prompt must fire, and exactly once.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
    (window as unknown as { __firstCalls: number; __secondCalls: number }).__firstCalls = 0;
    (window as unknown as { __firstCalls: number; __secondCalls: number }).__secondCalls = 0;
  });
});

test("ESC → reopen → Install uses only the latest BIP, exactly once", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    const mk = (key: "__firstCalls" | "__secondCalls") => {
      const ev = new Event("beforeinstallprompt") as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
      };
      ev.prompt = async () => {
        (window as unknown as Record<string, number>)[key] += 1;
      };
      ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
      return ev;
    };
    window.dispatchEvent(mk("__firstCalls"));
    window.dispatchEvent(mk("__secondCalls"));
  });

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Close with ESC.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Reopen the dialog.
  await trigger.click();
  await expect(dialog).toBeVisible();

  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toBeVisible();
  await installBtn.click();
  await expect(installBtn).toHaveCount(0);

  const state = await page.evaluate(() => ({
    first: (window as unknown as { __firstCalls: number }).__firstCalls,
    second: (window as unknown as { __secondCalls: number }).__secondCalls,
  }));
  expect(state.second).toBe(1);
  expect(state.first).toBe(0);
});
