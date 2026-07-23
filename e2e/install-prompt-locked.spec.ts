// E2E: the "Install as an app" dialog must not be dismissible via an X
// (close) button. ESC and focus-trap behavior continue to work.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

test("install-as-app dialog: X close is locked, ESC still closes", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // The shared shadcn DialogContent renders a close button with this
  // testid; the install-as-app dialog passes hideClose so it must not
  // be present at all.
  await expect(dialog.getByTestId("dialog-close")).toHaveCount(0);

  // Clicking outside the dialog must NOT close it either (locked panel).
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();

  // Focus trap still holds after Tab cycling.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() =>
      !!document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    );
    expect(inside, `focus escaped on Tab #${i + 1}`).toBe(true);
  }

  // ESC remains the only way to close, and restores focus to trigger.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("extension dialog keeps its X close button", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: new RegExp(dict.en["install.ext_title"]) })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Sanity: hideClose is install-as-app specific; the extension dialog
  // still ships the standard close affordance.
  await expect(dialog.getByTestId("dialog-close")).toHaveCount(1);
});
