// E2E: exercises the lock/unlock flow starting from BOTH provider modes
// (plaintext-seeded and encrypted-seeded) so save/load/decrypt behavior is
// verified end-to-end in each direction. Companion to note-lock-unlock.spec.ts.
//
// Run locally:
//   bunx playwright test e2e/note-lock-unlock-modes.spec.ts
//   bunx playwright test e2e/note-lock-unlock-modes.spec.ts --headed

import { test, expect } from "@playwright/test";
import {
  deleteNote,
  seedEncryptedNote,
  seedPlaintextNote,
} from "./helpers/seed-note";

const PASSPHRASE = "correct-horse-battery-staple";
const TEXT = "Round-trip content for mode coverage.";

function uniqueSlug(prefix: string): string {
  return `e2e-modes-${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

test.describe("lock/unlock across provider modes", () => {
  const created: string[] = [];
  test.afterEach(async () => {
    while (created.length) {
      const s = created.pop()!;
      await deleteNote(s).catch(() => {});
    }
  });

  test("plaintext-seeded: load → lock → reload → unlock → reload", async ({
    page,
  }) => {
    const slug = uniqueSlug("plain");
    created.push(slug);
    await seedPlaintextNote(slug, TEXT);

    await page.goto(`/${slug}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    await page.getByRole("button", { name: /encrypt/i }).click();
    await page.getByPlaceholder(/pass/i).first().fill(PASSPHRASE);
    await page.getByRole("button", { name: /^encrypt$/i }).click();
    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 15_000 });
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    await page.reload();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    await page.getByRole("button", { name: /encryption/i }).click();
    await page.getByRole("menuitem", { name: /unlock/i }).click();
    await page.waitForURL(new RegExp(`/${slug}(?!#)`), { timeout: 15_000 });
    await page.reload();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });
  });

  test("encrypted-seeded: decrypt via hash → unlock → reload → re-lock", async ({
    page,
  }) => {
    const slug = uniqueSlug("enc");
    created.push(slug);
    await seedEncryptedNote(slug, PASSPHRASE, TEXT);

    await page.goto(`/${slug}#${PASSPHRASE}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // Unlock back to plaintext.
    await page.getByRole("button", { name: /encryption/i }).click();
    await page.getByRole("menuitem", { name: /unlock/i }).click();
    await page.waitForURL(new RegExp(`/${slug}(?!#)`), { timeout: 15_000 });
    await page.reload();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    // Re-lock.
    await page.getByRole("button", { name: /encrypt/i }).click();
    await page.getByPlaceholder(/pass/i).first().fill(PASSPHRASE);
    await page.getByRole("button", { name: /^encrypt$/i }).click();
    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 15_000 });
    await page.reload();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });
  });
});
