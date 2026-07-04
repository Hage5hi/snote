// E2E: after the user accepts the first BIP via Install, dispatching
// a SECOND beforeinstallprompt must produce a clean single-flow round
// trip — not an accumulated re-fire. The second prompt() must be
// callable exactly once, and only the second event's prompt() should
// have been invoked in that round.
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

test("accept BIP → dispatch second BIP → second flow runs exactly once, no accumulation", async ({ page }) => {
  await page.goto("/");

  // Dispatch first BIP.
  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {
      (window as unknown as { __firstCalls: number }).__firstCalls += 1;
    };
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toBeVisible();
  await installBtn.click();
  // After a successful install flow, the button leaves the DOM because
  // the stored BIP event is consumed.
  await expect(installBtn).toHaveCount(0);

  let state = await page.evaluate(() => ({
    first: (window as unknown as { __firstCalls: number }).__firstCalls,
    second: (window as unknown as { __secondCalls: number }).__secondCalls,
  }));
  expect(state.first).toBe(1);
  expect(state.second).toBe(0);

  // Close the dialog and dispatch a SECOND BIP.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {
      (window as unknown as { __secondCalls: number }).__secondCalls += 1;
    };
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });

  // Reopen and Install again.
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(installBtn).toBeVisible();
  await installBtn.click();
  await expect(installBtn).toHaveCount(0);

  state = await page.evaluate(() => ({
    first: (window as unknown as { __firstCalls: number }).__firstCalls,
    second: (window as unknown as { __secondCalls: number }).__secondCalls,
  }));
  // First event must NOT be re-invoked (proves the app doesn't hang on
  // to stale BIP references).
  expect(state.first).toBe(1);
  // Second event fires exactly once (proves no listener accumulation —
  // a doubled listener would call prompt() twice for a single click).
  expect(state.second).toBe(1);
});
