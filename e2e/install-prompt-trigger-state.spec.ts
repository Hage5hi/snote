// E2E: while the install-as-app dialog is open, the panel trigger
// button is inert (Radix sets aria-hidden / pointer-events on siblings)
// so it must not be reachable via keyboard/pointer. After ESC-close
// AND after a history back navigation, the trigger returns to a
// clickable state and the in-dialog Install button reappears when
// BIP is re-dispatched.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

function dispatchBip(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const ev = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    ev.prompt = async () => {};
    ev.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(ev);
  });
}

test("trigger inert while dialog open; correct state after ESC + back-nav", async ({ page }) => {
  await page.goto("/");
  const triggerName = new RegExp(dict.en["install.title"]);
  const trigger = page.getByRole("button", { name: triggerName });
  await expect(trigger).toBeVisible();

  await dispatchBip(page);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const installBtn = dialog.getByRole("button", {
    name: new RegExp(`^${dict.en["install.btn"]}$`),
  });
  await expect(installBtn).toBeVisible();

  // Trigger must be inert (Radix hides siblings from AT / pointer).
  const triggerInert = await page.evaluate((label) => {
    const btns = Array.from(document.querySelectorAll("button"));
    const t = btns.find((b) => new RegExp(label).test(b.textContent ?? ""));
    if (!t) return { found: false };
    // Walk up looking for aria-hidden / inert set by Radix on the sibling.
    let el: HTMLElement | null = t;
    while (el && el !== document.body) {
      if (el.getAttribute("aria-hidden") === "true") return { found: true, inert: true };
      if ((el as HTMLElement & { inert?: boolean }).inert === true) return { found: true, inert: true };
      el = el.parentElement;
    }
    return { found: true, inert: false };
  }, dict.en["install.title"]);
  expect(triggerInert.found).toBe(true);
  expect(triggerInert.inert).toBe(true);

  // ESC close.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /^Install$/ })).toHaveCount(0);
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();

  // Back-nav dance: push /privacy then goBack.
  await page.goto("/privacy");
  await expect(page).toHaveURL(/\/privacy$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  const triggerAfter = page.getByRole("button", { name: triggerName });
  await expect(triggerAfter).toBeVisible();
  await expect(triggerAfter).toBeEnabled();

  // In-dialog Install button reappears in the correct state after a
  // fresh BIP on the remounted panel.
  await dispatchBip(page);
  await triggerAfter.click();
  const dialog2 = page.getByRole("dialog");
  await expect(dialog2).toBeVisible();
  await expect(
    dialog2.getByRole("button", { name: new RegExp(`^${dict.en["install.btn"]}$`) }),
  ).toHaveCount(1);
});
