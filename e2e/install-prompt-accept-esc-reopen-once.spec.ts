// E2E: accept the install prompt, ESC-close, reopen (with a fresh BIP)
// and verify the second Install click fires exactly once — no listener
// accumulation would double the call count for a single activation.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";
import { resetPromptSpy } from "./helpers/install-prompt";

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

const getCalls = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __calls: number }).__calls);

test("accept → ESC → reopen: Install fires exactly once per open", async ({ page }) => {
  await page.goto("/");

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  const dialog = page.getByRole("dialog");
  const installBtn = () =>
    dialog.getByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) });

  // First open + accept — reset spy so this open starts from zero.
  await resetPromptSpy(page, ["__calls"]);
  await dispatchBip(page);
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(installBtn()).toBeVisible();
  await installBtn().click();
  await expect(installBtn()).toHaveCount(0);
  expect(await getCalls(page)).toBe(1);

  // ESC-close, reset spy, reopen with a fresh BIP — this open must ALSO
  // observe exactly 1 call (accumulated listeners would produce >= 2).
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await resetPromptSpy(page, ["__calls"]);
  await dispatchBip(page);
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(installBtn()).toBeVisible();
  await installBtn().click();
  await expect(installBtn()).toHaveCount(0);
  expect(await getCalls(page)).toBe(1);
});

