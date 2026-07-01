// E2E: after multiple BIP dispatches, navigating away to another route
// and back must not stack listeners or replay the install flow. When we
// finally click Install, `prompt()` must fire exactly once (last-write-
// wins on the most recently dispatched event).
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

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

test("multiple BIP + route change + return → Install triggers exactly once", async ({ page }) => {
  await page.goto("/");
  await dispatchBip(page);
  await dispatchBip(page);
  await dispatchBip(page);

  // Navigate to /privacy and back to "/" (re-mounts the InstallPrompt).
  await page.goto("/privacy");
  await expect(page).toHaveURL(/\/privacy$/);
  await page.goto("/");

  // After re-mount, the previously-captured BIP is gone (React state
  // resets on unmount). Fire one final BIP so the button is live again.
  await dispatchBip(page);

  await page
    .getByRole("button", { name: new RegExp(dict.en["install.title"]) })
    .click();
  const dialog = page.getByRole("dialog");
  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toHaveCount(1);
  await installBtn.click();
  await expect(installBtn).toHaveCount(0);

  const calls = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  expect(calls).toBe(1);
});
