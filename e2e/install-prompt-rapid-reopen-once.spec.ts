// E2E: on each rapid reopen of the install dialog, the BIP handler
// must be bound exactly once — clicking Install increments the spy
// counter by strictly 1 per open, never 2+ (which would indicate an
// accumulated listener).
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";
import { noteFocus, resetFocusHistory, resetPromptSpy } from "./helpers/install-prompt";

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

// Loop bound is driven by IP_REOPEN_COUNT so ./scripts/debug-install-prompt-focus.sh
// -c N can actually reproduce the rapid-reopen scenario at the requested scale.
const REOPEN_COUNT = Number(process.env.IP_REOPEN_COUNT) || 4;

test("rapid reopen: prompt spy called strictly once per open", async ({ page }) => {
  await page.goto("/");
  await resetFocusHistory(page);

  // Stamp the effective config into the in-page focus history so it
  // shows up inside focus-trap-escape JSON dumps on failure.
  await page.evaluate(
    (cfg) => {
      const w = window as unknown as { __ipFocusHistory?: unknown[]; __ipReopenConfig?: unknown };
      w.__ipReopenConfig = cfg;
      w.__ipFocusHistory = w.__ipFocusHistory || [];
      w.__ipFocusHistory.push({ at: Date.now(), event: "config", ...cfg });
    },
    { reopenCount: REOPEN_COUNT, envRaw: process.env.IP_REOPEN_COUNT ?? null },
  );
  console.log(`[rapid-reopen] IP_REOPEN_COUNT=${process.env.IP_REOPEN_COUNT ?? "<unset>"} -> REOPEN_COUNT=${REOPEN_COUNT}`);

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  const dialog = page.getByRole("dialog");
  const install = page.getByRole("button", { name: new RegExp(dict.en["install.btn"]) });

  for (let i = 0; i < REOPEN_COUNT; i++) {
    await noteFocus(page, `iter-${i + 1}-before-open`);
    await resetPromptSpy(page);
    await fireBip(page);
    await trigger.click();
    await expect(dialog).toBeVisible();
    await noteFocus(page, `iter-${i + 1}-after-open`);
    await install.click();
    expect(await getCalls(page), `open #${i + 1}: prompt() call count`).toBe(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await noteFocus(page, `iter-${i + 1}-after-close`);
  }
});

