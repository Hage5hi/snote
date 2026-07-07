// E2E: renaming a note after local edits must not let the old Yjs provider's
// debounced snapshot recreate the deleted old slug row.

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { deleteNote, seedPlaintextNote, versionedSlug } from "./helpers/seed-note";

const TEXT = "Rename race content";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name} (needed for E2E verification).`);
  return value;
}

function client() {
  return createClient(env("VITE_SUPABASE_URL"), env("VITE_SUPABASE_PUBLISHABLE_KEY"));
}

async function noteExists(slug: string): Promise<boolean> {
  const { data, error } = await client().from("notes").select("slug").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return !!data;
}

test.describe("note rename Yjs race", () => {
  let oldSlug: string;
  let newSlug: string;

  test.beforeEach(async () => {
    oldSlug = versionedSlug("rename-old");
    newSlug = versionedSlug("rename-new");
    await seedPlaintextNote(oldSlug, TEXT);
    await deleteNote(newSlug).catch(() => {});
  });

  test.afterEach(async () => {
    await deleteNote(oldSlug).catch(() => {});
    await deleteNote(newSlug).catch(() => {});
  });

  test("renames after pending Yjs edits and old slug stays gone after debounce", async ({ page }) => {
    await page.goto(`/${oldSlug}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
    await page.keyboard.type(" pending edit");

    await page.getByRole("button", { name: /^note/i }).click();
    await page.getByRole("menuitem", { name: /rename/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder(/new-slug|slug/i).fill(newSlug);
    const submit = dialog.getByRole("button", { name: /^rename$/i });
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await submit.click();

    await page.waitForURL(new RegExp(`/${newSlug}$`), { timeout: 15_000 });
    await expect(editor).toContainText(`${TEXT} pending edit`, { timeout: 15_000 });

    // Provider debounce is 800ms and finalizeRename has a 750ms second-pass
    // delete. Waiting beyond both catches any late snapshot resurrection.
    await page.waitForTimeout(2_000);

    await expect.poll(() => noteExists(oldSlug), { timeout: 5_000 }).toBe(false);
    await expect.poll(() => noteExists(newSlug), { timeout: 5_000 }).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/${newSlug}$`));
  });
});