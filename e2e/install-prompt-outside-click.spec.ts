// E2E: clicking on the dialog overlay (backdrop) for the install-as-app
// dialog must NOT close it — onPointerDownOutside / onInteractOutside
// are preventDefault'd. Focus trap must still be active afterwards.
import { test, expect } from "@playwright/test";
import { dict } from "../src/i18n/catalog";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

test("backdrop click does not close install-as-app dialog; focus trap holds", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Locate the Radix overlay element rendered as a sibling of the
  // dialog content. It covers the viewport behind the panel.
  const overlay = page.locator('[data-radix-dialog-overlay], [data-state="open"].fixed.inset-0').first();
  // Fallback: click a corner well outside the dialog box.
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  const overlayCount = await overlay.count();
  if (overlayCount > 0) {
    await overlay.click({ position: { x: 5, y: 5 }, force: true });
  } else {
    // Click far outside the dialog rectangle.
    await page.mouse.click(5, 5);
  }

  // Dialog must remain open.
  await expect(dialog).toBeVisible();

  // Focus trap must still hold across a few Tab cycles.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      () => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    );
    expect(inside, `focus escaped on Tab #${i + 1}`).toBe(true);
  }

  // ESC still works as the sole close affordance.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
