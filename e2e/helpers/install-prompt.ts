// Shared helpers for install-prompt e2e specs.
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { dict } from "../../src/i18n/index";


/**
 * Reset the prompt() spy counters on `window` so every dialog open in a
 * test starts from zero. Prevents false "listener accumulated" failures
 * when a test reopens the dialog multiple times.
 */
export async function resetPromptSpy(
  page: Page,
  keys: readonly string[] = ["__calls", "__firstCalls", "__secondCalls", "__bipCalls"],
) {
  await page.evaluate((ks) => {
    for (const k of ks) {
      (window as unknown as Record<string, number>)[k] = 0;
    }
  }, keys as string[]);
}

/**
 * Assert focus is inside the open dialog. On failure, attach a DOM
 * dump (focusable list + activeElement descriptor + dialog outerHTML
 * preview) to the Playwright test report so it's obvious why Shift+Tab
 * escaped the focus trap.
 */
export async function expectFocusInsideDialog(
  page: Page,
  testInfo: TestInfo,
  label: string,
  opts: { triggerNonce?: string } = {},
) {
  const info = await page.evaluate((nonceAttr) => {
    const dlg = document.querySelector('[role="dialog"]');
    const active = document.activeElement as HTMLElement | null;
    const sel = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const describe = (el: Element | null) =>
      el
        ? {
            tag: el.tagName.toLowerCase(),
            id: (el as HTMLElement).id || null,
            name: el.getAttribute("name"),
            ariaLabel: el.getAttribute("aria-label"),
            role: el.getAttribute("role"),
            text: (el.textContent || "").trim().slice(0, 60),
          }
        : null;
    const focusables = dlg
      ? Array.from(dlg.querySelectorAll<HTMLElement>(sel)).map(describe)
      : [];
    const nonceEl = document.querySelector(`[${nonceAttr}]`);
    return {
      dialogPresent: !!dlg,
      dialogContainsActive: !!(dlg && active && dlg.contains(active)),
      activeElement: describe(active),
      focusables,
      latestTriggerNonce: nonceEl?.getAttribute(nonceAttr) ?? null,
      dialogHtmlPreview: dlg ? (dlg as HTMLElement).outerHTML.slice(0, 2000) : null,
    };
  }, TRIGGER_NONCE_ATTR);

  const payload = {
    label,
    testTitle: testInfo.title,
    triggerNonce: opts.triggerNonce ?? info.latestTriggerNonce,
    ...info,
  };

  if (!info.dialogContainsActive) {
    const fileName = `focus-trap-escape-${label}.json`;
    await testInfo.attach(fileName, {
      body: JSON.stringify(payload, null, 2),
      contentType: "application/json",
    });
    // Also write to the test's outputDir so CI can list the exact path
    // per attempt/browser without parsing the JSON report.
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.mkdir(testInfo.outputDir, { recursive: true });
      await fs.writeFile(
        path.join(testInfo.outputDir, fileName),
        JSON.stringify(payload, null, 2),
      );
    } catch {
      /* best-effort */
    }
  }
  expect(info.dialogContainsActive, `focus escaped at ${label}`).toBe(true);
}


/**
 * Robust re-location of the install trigger button after the dialog
 * closes. Radix re-renders / re-mounts DialogTrigger, so a Locator
 * captured before opening can become detached. This helper:
 *   1. Tags the element with a stable data attribute + a unique nonce
 *      before opening so we can re-select the SAME node afterwards.
 *   2. Returns a locator that filters by that nonce, and asserts it
 *      resolves to exactly one element before use.
 *
 * Usage:
 *   const trigger = await captureInstallTrigger(page);
 *   await trigger.click();
 *   // ... open + close dialog ...
 *   const same = await relocateInstallTrigger(page, trigger);
 *   await expect(same).toBeFocused();
 */
const TRIGGER_NONCE_ATTR = "data-e2e-trigger-nonce";

export interface CapturedTrigger {
  locator: Locator;
  nonce: string;
}

export async function captureInstallTrigger(page: Page): Promise<CapturedTrigger> {
  const base = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(base).toBeVisible();
  const nonce = `ip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await base.evaluate((el, n) => el.setAttribute("data-e2e-trigger-nonce", n), nonce);
  const locator = page.locator(`[${TRIGGER_NONCE_ATTR}="${nonce}"]`);
  await expect(locator).toHaveCount(1);
  return { locator, nonce };
}

export async function relocateInstallTrigger(
  page: Page,
  captured: CapturedTrigger,
): Promise<Locator> {
  const byNonce = page.locator(`[${TRIGGER_NONCE_ATTR}="${captured.nonce}"]`);
  const count = await byNonce.count();
  if (count === 1) return byNonce;
  // Radix re-mounted the trigger and dropped our attribute — re-tag
  // the current trigger by accessible name and return the fresh handle.
  const fresh = page.getByRole("button", {
    name: new RegExp(dict.en["install.title"]),
  });
  await expect(fresh).toHaveCount(1);
  await fresh.evaluate(
    (el, n) => el.setAttribute("data-e2e-trigger-nonce", n),
    captured.nonce,
  );
  return page.locator(`[${TRIGGER_NONCE_ATTR}="${captured.nonce}"]`);
}

