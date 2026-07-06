// Deterministic waits for the "locked" UI state — reduces Playwright flake by
// combining multiple observable signals instead of relying on any single one.
//
// A note is considered "locked in the UI" when ALL of these hold:
//   - No `.cm-content[contenteditable='true']` exists on the page.
//   - No visible "Save"/"Encrypt (submit)" button is enabled.
//
// Callers can also assert the inverse (unlocked / editable) via
// `waitForNoteEditable`.

import { expect, type Page } from "@playwright/test";

export type LockedWaitOptions = {
  /** Overall budget for the wait (default 5s). */
  timeout?: number;
  /** Playwright poll intervals — increasing to keep CPU low. */
  intervals?: number[];
};

const DEFAULT_INTERVALS = [25, 50, 100, 200];

/** Wait until the editor is non-editable AND save-like buttons are disabled/gone. */
export async function waitForNoteLocked(
  page: Page,
  opts: LockedWaitOptions = {},
): Promise<void> {
  const timeout = opts.timeout ?? 5_000;
  const intervals = opts.intervals ?? DEFAULT_INTERVALS;

  await expect
    .poll(
      async () => {
        const editable = await page
          .locator(".cm-content[contenteditable='true']")
          .count();
        if (editable > 0) return "editor-still-editable";

        // Any enabled Save / Encrypt-submit button means the user could still
        // trigger a write — not yet locked from a save-safety perspective.
        const enabledSaves = await page
          .locator(
            "button:enabled:has-text('Save'), button:enabled:has-text('Encrypt')",
          )
          .count();
        // The top-level "Encrypt" menu opener is always present; only fail if
        // there's a SUBMIT-style button visible in a dialog.
        const dialogSaves = await page
          .locator(
            "[role='dialog'] button:enabled:has-text('Save'), [role='dialog'] button:enabled:has-text('Encrypt')",
          )
          .count();
        if (dialogSaves > 0) return `dialog-save-enabled(${enabledSaves})`;

        return "locked";
      },
      { timeout, intervals },
    )
    .toBe("locked");
}

/** Wait for the inverse: editor is editable and save is possible again. */
export async function waitForNoteEditable(
  page: Page,
  opts: LockedWaitOptions = {},
): Promise<void> {
  const timeout = opts.timeout ?? 5_000;
  const intervals = opts.intervals ?? DEFAULT_INTERVALS;

  await expect
    .poll(
      async () =>
        await page.locator(".cm-content[contenteditable='true']").count(),
      { timeout, intervals },
    )
    .toBeGreaterThan(0);
}
