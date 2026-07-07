import { expect, type Page } from "@playwright/test";

/**
 * Asserts that the current page does NOT contain the note content for a given slug.
 * Since we don't have a 404 page, we check for an empty editor or a redirect.
 */
export async function expectNoteNotFound(page: Page, slug: string) {
  // If we redirected away from the slug, that's one way of being "not found"
  if (!page.url().includes(slug)) return;
  
  const editor = page.locator(".cm-content").first();
  // An empty editor in a "not found" state should not have any text we seeded.
  // We use a reasonably long timeout to ensure no late hydration occurs.
  await expect(editor).not.toHaveText(/.+/, { timeout: 5000 });
}

/**
 * Asserts that a toast with the given title is visible.
 */
export async function expectToast(page: Page, title: string | RegExp) {
  const toast = page.getByRole("status").filter({ hasText: title });
  await expect(toast).toBeVisible({ timeout: 10000 });
}
