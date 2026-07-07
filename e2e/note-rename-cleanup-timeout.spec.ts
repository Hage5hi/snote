// E2E: when the old-slug-cleanup-status endpoint never reports `cleaned`,
// the RenameDialog must render the timeout warning and stop polling. We
// simulate this by intercepting the edge-function call and always returning
// `cleaned: false` — the UI should surface the timeout state (not spin
// forever) and expose a retry affordance.
import { test, expect } from "@playwright/test";
import { deleteNote, seedPlaintextNote, versionedSlug } from "./helpers/seed-note";
import { purgeSlugs } from "./helpers/rename-cleanup";

test.describe("rename cleanup timeout UI", () => {
  let oldSlug: string;
  let newSlug: string;

  test.beforeEach(async () => {
    oldSlug = versionedSlug("cleanup-timeout-old");
    newSlug = versionedSlug("cleanup-timeout-new");
    await purgeSlugs([oldSlug, newSlug]);
    await seedPlaintextNote(oldSlug, "timeout test");
  });

  test.afterEach(async () => {
    await purgeSlugs([oldSlug, newSlug]);
  });

  test("shows timeout warning and stops polling when cleanup never confirms", async ({ page }) => {
    // Force cleanup-status to always report the row as still-present.
    await page.route("**/functions/v1/old-slug-cleanup-status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slug: oldSlug,
          source: "edge-function",
          database: {
            rowPresent: true,
            row: { slug: oldSlug, char_count: 12, updated_at: null, ydoc_state_len: 4, content_len: 12 },
          },
          clientSignals: { providerAbandoned: true },
          cleaned: false,
          metrics: { dbMs: 5, totalMs: 7 },
        }),
      });
    });

    await page.goto(`/${oldSlug}`);
    await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /^note/i }).click();
    await page.getByRole("menuitem", { name: /rename/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder(/new-slug|slug/i).fill(newSlug);
    const submit = dialog.getByRole("button", { name: /^rename$/i });
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await submit.click();

    const status = dialog.locator("[data-testid=rename-cleanup-status]");
    // Poll runs for 8s; wait up to 12s for it to converge to timeout/dirty.
    await expect(status).toHaveAttribute("data-cleanup-state", /timeout|dirty/, { timeout: 12_000 });
    await expect(status).toContainText(/timed out|still present/i);
    await expect(dialog.locator("[data-testid=rename-cleanup-retry]")).toBeVisible();

    // Verify metrics render in the detail line.
    await expect(status).toContainText(/totalMs=/);

    // Polling must have stopped — no further requests after the terminal state.
    let extra = 0;
    await page.route("**/functions/v1/old-slug-cleanup-status", () => { extra++; });
    await page.waitForTimeout(1_500);
    expect(extra, "cleanup-status polling should have stopped").toBe(0);

    await deleteNote(oldSlug).catch(() => {});
  });
});
