// E2E: a11y assertions for the non-dismissible InstallPrompt panel.
//
// Covers:
//   - The panel is a labelled <region> landmark and has no close button.
//   - Trigger buttons have accessible names from the i18n dictionary.
//   - Keyboard open: focusing a trigger and pressing Enter opens the
//     dialog and moves focus inside it.
//   - Focus trap: Tab cycles stay inside [role="dialog"].
//   - Escape closes the dialog and restores focus to the trigger.
//   - Step toggle buttons expose accessible names.
//   - Axe scan against the open dialog introduces no new serious/critical
//     violations vs. the baseline taken before opening.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { dict } from "../src/i18n/index";

type Violation = { id: string; impact?: string | null };

async function scan(page: Page): Promise<Violation[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["region"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact ?? null }));
}

function newViolations(baseline: Violation[], current: Violation[]): Violation[] {
  const seen = new Set(baseline.map((v) => v.id));
  return current.filter((v) => !seen.has(v.id));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("lang.ip_detected", "1");
  });
});

test("install panel is a labelled region, non-dismissible", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("install-prompt");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("role", "region");
  await expect(panel).toHaveAttribute("aria-label", dict.en["install.panel_label"]);

  // No close button inside the panel — it must not be dismissible.
  const closers = panel.locator(
    'button[aria-label*="close" i], button[aria-label*="dismiss" i]',
  );
  await expect(closers).toHaveCount(0);
});

test("trigger buttons expose accessible names", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: new RegExp(dict.en["install.title"]) }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp(dict.en["install.ext_title"]) }),
  ).toBeVisible();
});

test("keyboard opens install-as-app dialog and moves focus inside", async ({ page }) => {
  await page.goto("/");
  const baseline = await scan(page);

  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Focus must land inside the dialog (Radix moves it).
  const focusedInsideDialog = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return !!dlg && dlg.contains(document.activeElement);
  });
  expect(focusedInsideDialog).toBe(true);

  // Step toggle buttons have accessible names from i18n.
  const stepBtns = dialog.locator("ol button");
  const count = await stepBtns.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const label = await stepBtns.nth(i).getAttribute("aria-label");
    expect(
      [dict.en["install.step_completed"], dict.en["install.step_mark"]].some(
        (expectedLabel) => expectedLabel === label,
      ),
      `step ${i} aria-label "${label}"`,
    ).toBe(true);
  }

  // Focus-trap probe: Tab N times, focus must stay within the dialog.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return !!dlg && dlg.contains(document.activeElement);
    });
    expect(inside, `focus escaped on Tab #${i + 1}`).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Shift+Tab");
    const inside = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return !!dlg && dlg.contains(document.activeElement);
    });
    expect(inside, `focus escaped on Shift+Tab #${i + 1}`).toBe(true);
  }

  // Axe scan with the dialog open — no new serious/critical violations.
  const open = await scan(page);
  expect(newViolations(baseline, open)).toEqual([]);

  // Escape closes and returns focus to the trigger.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("extension dialog: focus trap + Escape returns focus to trigger", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: new RegExp(dict.en["install.ext_title"]),
  });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return !!dlg && dlg.contains(document.activeElement);
    });
    expect(inside, `focus escaped on Tab #${i + 1}`).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
