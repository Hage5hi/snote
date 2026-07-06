// E2E: measure Yjs provider remount timing during lock/unlock and fail if
// the editor stays editable longer than a tight threshold. The transition
// window (from clicking "Encrypt" to the editor becoming non-editable) must
// be short so users cannot enqueue writes into a stale provider.

import { test, expect } from "@playwright/test";
import { deleteNote, seedPlaintextNote } from "./helpers/seed-note";
import { uniqueSlug } from "./helpers/note-writes";

const PASSPHRASE = "correct-horse-battery-staple";
const TEXT = "Remount timing probe.";

// Max acceptable time (ms) between initiating the lock and the editor
// becoming non-editable. Generous enough for CI jitter, tight enough that a
// regression (e.g. remount happening on a macrotask chain) would blow it.
const MAX_EDITABLE_WINDOW_MS = 1_500;

test.describe("provider remount timing", () => {
  let slug: string;

  test.beforeEach(async () => {
    slug = uniqueSlug("timing");
    await seedPlaintextNote(slug, TEXT);
  });

  test.afterEach(async () => {
    await deleteNote(slug).catch(() => {});
  });

  test("editor becomes non-editable within threshold on lock", async ({
    page,
  }) => {
    await page.goto(`/${slug}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    await page.getByRole("button", { name: /encrypt/i }).click();
    await page.getByPlaceholder(/pass/i).first().fill(PASSPHRASE);

    const started = Date.now();
    await page.getByRole("button", { name: /^encrypt$/i }).click();

    // Poll for the editable→non-editable transition.
    await expect
      .poll(
        async () =>
          await page.locator(".cm-content[contenteditable='true']").count(),
        { timeout: MAX_EDITABLE_WINDOW_MS + 500, intervals: [25, 50, 100] },
      )
      .toBe(0);

    const elapsed = Date.now() - started;
    expect(
      elapsed,
      `Editor stayed editable for ${elapsed}ms during remount (max ${MAX_EDITABLE_WINDOW_MS}ms)`,
    ).toBeLessThanOrEqual(MAX_EDITABLE_WINDOW_MS);

    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 15_000 });
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });
  });
});
