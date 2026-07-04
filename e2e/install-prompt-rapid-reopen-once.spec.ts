// E2E: on each rapid reopen of the install dialog, the BIP handler
// must be bound exactly once — clicking Install increments the spy
// counter by strictly 1 per open, never 2+ (which would indicate an
// accumulated listener).
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";
import { resetPromptSpy } from "./helpers/install-prompt";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

async function fireBip(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    (window as unknown as { __calls: number }).__calls =
      (window as unknown as { __calls?: number }).__calls || 0;
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {
      (window as unknown as { __calls: number }).__calls++;
    };
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });
}

const getCalls = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __calls?: number }).__calls ?? 0);

test("rapid reopen: prompt spy called strictly once per open", async ({ page }) => {
  await page.goto("/");

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  const dialog = page.getByRole("dialog");
  const install = page.getByRole("button", { name: new RegExp(dict.en["install.btn"]) });

  for (let i = 0; i < 4; i++) {
    await resetPromptSpy(page);
    await fireBip(page);
    await trigger.click();
    await expect(dialog).toBeVisible();
    await install.click();
    // After accept, dialog stays open (product hides the Install button
    // once BIP is consumed) — ESC to close for the next iteration.
    expect(await getCalls(page), `open #${i + 1}: prompt() call count`).toBe(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});
