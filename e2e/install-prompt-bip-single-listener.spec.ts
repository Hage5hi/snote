// E2E: repeatedly dispatching `beforeinstallprompt` must not stack
// listeners or replay multiple install flows. Clicking Install once
// after N BIP dispatches must invoke `prompt()` exactly once (on the
// latest captured event), proving the component holds a single
// reference and doesn't accumulate handlers across re-mounts.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
    (window as unknown as { __bipCalls: number }).__bipCalls = 0;
  });
});

test("multiple BIP dispatches → Install click invokes prompt() exactly once", async ({ page }) => {
  await page.goto("/");

  // Dispatch 4 distinct BIP events; each one's prompt() bumps a global
  // counter so we can detect double-invocation or listener stacking.
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      const ev = new Event("beforeinstallprompt") as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
      };
      ev.prompt = async () => {
        (window as unknown as { __bipCalls: number }).__bipCalls += 1;
      };
      ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
      window.dispatchEvent(ev);
    }
  });

  await page
    .getByRole("button", { name: new RegExp(dict.en["install.title"]) })
    .click();
  const dialog = page.getByRole("dialog");
  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toHaveCount(1);

  await installBtn.click();
  // Wait for the userChoice promise chain to settle in the component.
  await expect(installBtn).toHaveCount(0);

  const calls = await page.evaluate(
    () => (window as unknown as { __bipCalls: number }).__bipCalls,
  );
  expect(calls).toBe(1);
});
