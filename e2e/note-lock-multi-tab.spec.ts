// E2E: multi-tab lock enforcement.
//
// Tab A locks the note. Tab B (opened before the lock takes effect) attempts
// to save/edit. We assert that no write from Tab B succeeds against the notes
// endpoint until the note is unlocked again in Tab A.

import { test, expect } from "@playwright/test";
import { deleteNote, seedPlaintextNote } from "./helpers/seed-note";
import { trackNoteWrites, uniqueSlug } from "./helpers/note-writes";

// Always retain traces/videos for these multi-context lock specs.
test.use({ trace: "on", video: "on", screenshot: "only-on-failure" });

const PASSPHRASE = "correct-horse-battery-staple";
const TEXT = "Multi-tab lock coordination test.";

test.describe("multi-tab lock enforcement", () => {
  let slug: string;

  test.beforeEach(async () => {
    slug = uniqueSlug("multitab");
    await seedPlaintextNote(slug, TEXT);
  });

  test.afterEach(async () => {
    await deleteNote(slug).catch(() => {});
  });

  test("second tab cannot save while first tab has the note locked", async ({
    context,
  }) => {
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const readWritesB = await trackNoteWrites(tabB);

    await tabA.goto(`/${slug}`);
    await tabB.goto(`/${slug}`);
    const editorA = tabA.locator(".cm-content").first();
    const editorB = tabB.locator(".cm-content").first();
    await expect(editorA).toContainText(TEXT, { timeout: 15_000 });
    await expect(editorB).toContainText(TEXT, { timeout: 15_000 });

    // Lock in tab A.
    await tabA.getByRole("button", { name: /encrypt/i }).click();
    await tabA.getByPlaceholder(/pass/i).first().fill(PASSPHRASE);
    await tabA.getByRole("button", { name: /^encrypt$/i }).click();
    await tabA.waitForURL(new RegExp(`/${slug}#`), { timeout: 15_000 });

    // Reset tab B's write log so we only count writes that fire post-lock.
    const preLockWrites = await readWritesB();
    preLockWrites.length = 0;

    // Try to edit in tab B (still on plaintext URL, without the passphrase).
    // Without a valid key, saves must not reach the notes endpoint.
    await tabB.reload();
    if (await editorB.isEditable().catch(() => false)) {
      await editorB.click();
      await tabB.keyboard.type("stale-edit-from-tab-B");
      await tabB.waitForTimeout(1_500);
    }
    const writesWhileLocked = (await readWritesB()).filter(
      (w) => w.method !== "GET",
    );
    expect(
      writesWhileLocked,
      `Tab B should not have written while locked:\n${JSON.stringify(writesWhileLocked, null, 2)}`,
    ).toEqual([]);

    // Unlock via tab A.
    await tabA.getByRole("button", { name: /encryption/i }).click();
    await tabA.getByRole("menuitem", { name: /unlock/i }).click();
    await tabA.waitForURL(new RegExp(`/${slug}(?!#)`), { timeout: 15_000 });

    // Tab B reloads and can now see plaintext again.
    await tabB.reload();
    await expect(editorB).toContainText(TEXT, { timeout: 15_000 });
  });
});
