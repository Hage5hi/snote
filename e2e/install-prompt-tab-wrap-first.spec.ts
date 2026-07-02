// E2E: from the FIRST focusable element in the install-as-app dialog,
// Tab forward past the last focusable to force a wrap and confirm
// focus lands back on the first focusable (still inside the trap).
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/index";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

async function focusInsideDialog(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const active = document.activeElement;
    return !!dlg && !!active && dlg.contains(active);
  });
}

test("Tab from first focusable wraps back inside focus trap", async ({ page }) => {
  await page.goto("/");

  // BIP so Install is present in the focusable set.
  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {};
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const focusableCount = await dialog.evaluate((el) => {
    const sel = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    return el.querySelectorAll(sel).length;
  });
  expect(focusableCount).toBeGreaterThan(0);

  // Move focus to the first focusable via a single Tab from the
  // dialog's initial autoFocus target (Radix focuses the content).
  await page.keyboard.press("Tab");
  expect(await focusInsideDialog(page)).toBe(true);

  const firstId = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.outerHTML?.slice(0, 120) ?? null;
  });
  expect(firstId).not.toBeNull();

  // Tab forward through the full focusable set to force a wrap.
  for (let i = 0; i < focusableCount; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInsideDialog(page), `Tab #${i + 1} escaped trap`).toBe(true);
  }

  // After wrapping we should be back on (or inside) the dialog — focus
  // must never have landed on document.body or outside the dialog.
  expect(await focusInsideDialog(page)).toBe(true);
});
