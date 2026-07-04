// Shared helpers for install-prompt e2e specs.
import { expect, type Page, type TestInfo } from "@playwright/test";

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
) {
  const info = await page.evaluate(() => {
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
            text: (el.textContent || "").trim().slice(0, 60),
          }
        : null;
    const focusables = dlg
      ? Array.from(dlg.querySelectorAll<HTMLElement>(sel)).map(describe)
      : [];
    return {
      dialogPresent: !!dlg,
      dialogContainsActive: !!(dlg && active && dlg.contains(active)),
      activeElement: describe(active),
      focusables,
      dialogHtmlPreview: dlg ? (dlg as HTMLElement).outerHTML.slice(0, 2000) : null,
    };
  });

  if (!info.dialogContainsActive) {
    await testInfo.attach(`focus-trap-escape-${label}.json`, {
      body: JSON.stringify(info, null, 2),
      contentType: "application/json",
    });
  }
  expect(info.dialogContainsActive, `focus escaped at ${label}`).toBe(true);
}
