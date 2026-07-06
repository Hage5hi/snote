// E2E: lock → change URL hash → browser back/forward → reload, and verify
// the note still decrypts on the encrypted route and stays non-editable
// while locked (no accidental writes possible during navigation churn).

import { test, expect } from "@playwright/test";
import { deleteNote, seedPlaintextNote } from "./helpers/seed-note";

const PASSPHRASE = "correct-horse-battery-staple";
const TEXT = "History-nav content — survives back/forward.";

function uniqueSlug(): string {
  return `e2e-hist-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

test.describe("locked note across history navigation", () => {
  let slug: string;

  test.beforeEach(async () => {
    slug = uniqueSlug();
    await seedPlaintextNote(slug, TEXT);
  });

  test.afterEach(async () => {
    await deleteNote(slug).catch(() => {});
  });

  test("lock → hash change → back/forward → reload → still decryptable", async ({
    page,
  }) => {
    await page.goto(`/${slug}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // Lock.
    await page.getByRole("button", { name: /encrypt/i }).click();
    await page.getByPlaceholder(/pass/i).first().fill(PASSPHRASE);
    await page.getByRole("button", { name: /^encrypt$/i }).click();
    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 15_000 });
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // Push a distinct hash entry, then a second one, so back/forward has room
    // to move across the history stack without leaving the note route.
    await page.evaluate((pass) => {
      history.pushState(null, "", `${location.pathname}#${pass}&marker=a`);
    }, PASSPHRASE);
    await page.evaluate((pass) => {
      history.pushState(null, "", `${location.pathname}#${pass}&marker=b`);
    }, PASSPHRASE);

    // Back and forward through the stack.
    await page.goBack();
    await page.goBack();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });
    await page.goForward();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // Full reload — content still decrypts.
    await page.reload();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // While locked, the editor must not be editable (guards against edits
    // that would race the provider's decrypted state).
    await expect(page.locator(".cm-content[contenteditable='true']")).toHaveCount(
      0,
    );
  });
});
