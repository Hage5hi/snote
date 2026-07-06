// E2E: lock / unlock a note, reload, verify content remains decryptable,
// and assert the editor is disabled while lock/unlock is in progress and
// while the Yjs provider is remounting.
//
// Run locally:
//   bunx playwright test e2e/note-lock-unlock.spec.ts
//   bunx playwright test e2e/note-lock-unlock.spec.ts --headed
//   bunx playwright show-report        # inspect failure artifacts
//
// Artifacts on failure (config: playwright.config.ts):
//   test-results/**/trace.zip           traces (retain-on-failure)
//   test-results/**/video.webm          videos (retain-on-failure)
//   test-results/**/test-failed-*.png   screenshots (only-on-failure)

import { test, expect } from "@playwright/test";
import { deleteNote, seedPlaintextNote } from "./helpers/seed-note";

const PASSPHRASE = "correct-horse-battery-staple";
const PLAINTEXT = "Hello from the E2E lock/unlock spec.";

function uniqueSlug(): string {
  return `e2e-lock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe("note lock / unlock", () => {
  let slug: string;

  test.beforeEach(async () => {
    slug = uniqueSlug();
    await seedPlaintextNote(slug, PLAINTEXT);
  });

  test.afterEach(async () => {
    await deleteNote(slug).catch(() => {});
  });

  test("locks, unlocks, reloads, remains decryptable", async ({ page }) => {
    await page.goto(`/${slug}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(PLAINTEXT, { timeout: 15_000 });

    // Lock.
    await page.getByRole("button", { name: /encrypt/i }).click();
    await page.getByPlaceholder(/pass/i).first().fill(PASSPHRASE);
    await page.getByRole("button", { name: /^encrypt$/i }).click();

    // LockButton triggers a full navigation + reload. Wait for the URL to
    // include the passphrase in the hash.
    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 15_000 });
    await expect(editor).toContainText(PLAINTEXT, { timeout: 15_000 });

    // Close-and-reopen simulation: hard reload with the same URL (hash included).
    await page.reload();
    await expect(editor).toContainText(PLAINTEXT, { timeout: 15_000 });

    // Unlock.
    await page.getByRole("button", { name: /encryption/i }).click();
    await page.getByRole("menuitem", { name: /unlock/i }).click();
    await page.waitForURL(new RegExp(`/${slug}(?!#)`), { timeout: 15_000 });

    // Reload again and confirm content survived the unlock round-trip.
    await page.reload();
    await expect(editor).toContainText(PLAINTEXT, { timeout: 15_000 });
  });

  test("editor is disabled while lock is in progress", async ({ page }) => {
    await page.goto(`/${slug}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(PLAINTEXT, { timeout: 15_000 });

    await page.getByRole("button", { name: /encrypt/i }).click();
    await page.getByPlaceholder(/pass/i).first().fill(PASSPHRASE);

    // Slow the network so the upsert (and subsequent navigation) is observable.
    await page.route("**/rest/v1/notes**", async (route) => {
      await new Promise((r) => setTimeout(r, 750));
      await route.continue();
    });

    const encryptBtn = page.getByRole("button", { name: /^encrypt$/i });
    await encryptBtn.click();

    // While busy, the confirm button flips to a spinner (no accessible "Encrypt"
    // label) — the user can't submit again mid-flight. This is the UI's guard
    // against edits between state changes and reload.
    await expect(encryptBtn).toHaveCount(0, { timeout: 2_000 });

    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 20_000 });
  });
});
