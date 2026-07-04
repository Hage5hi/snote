// E2E: accept the install prompt, ESC-close, reopen (with a fresh BIP)
// and verify the second Install click fires exactly once — no listener
// accumulation would double the call count for a single activation.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
    (window as unknown as { __calls: number }).__calls = 0;
  });
});

async function dispatchBip(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {
      (window as unknown as { __calls: number }).__calls += 1;
    };
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });
}

test("accept → ESC → reopen: Install fires exactly once per open", async ({ page }) => {
  await page.goto("/");

  await dispatchBip(page);

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  const dialog = page.getByRole("dialog");
  const installBtn = () =>
    dialog.getByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) });

  // First open + accept.
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(installBtn()).toBeVisible();
  await installBtn().click();
  await expect(installBtn()).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __calls: number }).__calls)).toBe(1);

  // ESC-close and reopen with a fresh BIP.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await dispatchBip(page);
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(installBtn()).toBeVisible();
  await installBtn().click();
  await expect(installBtn()).toHaveCount(0);

  // Exactly 2 total (one per Install click). A doubled listener would
  // give 3 (1 + 2) here.
  expect(await page.evaluate(() => (window as unknown as { __calls: number }).__calls)).toBe(2);
});
