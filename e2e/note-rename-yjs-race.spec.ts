// E2E: renaming a note after local edits must not let the old Yjs provider's
// debounced snapshot recreate the deleted old slug row.
//
// On failure this spec attaches:
//   - browser console + page errors captured during the run
//   - a DB snapshot of the old slug row (so resurrections are trivial to spot)
//   - Playwright's own trace/video (see playwright.config.ts `retain-on-failure`)

import { test, expect } from "@playwright/test";
import { deleteNote, seedPlaintextNote, versionedSlug } from "./helpers/seed-note";
import { snapshotSlugRow, waitForSlugAbsent } from "./helpers/db-assert";

const TEXT = "Rename race content";

test.describe("note rename Yjs race", () => {
  let oldSlug: string;
  let newSlug: string;

  test.beforeEach(async () => {
    oldSlug = versionedSlug("rename-old");
    newSlug = versionedSlug("rename-new");
    // Reset DB state defensively — a prior aborted run could have left rows
    // under these exact slugs (versionedSlug is unique per-run, but be safe
    // against a re-invocation with a re-seeded random).
    await deleteNote(oldSlug).catch(() => {});
    await deleteNote(newSlug).catch(() => {});
    await seedPlaintextNote(oldSlug, TEXT);
  });

  test.afterEach(async ({ page }, testInfo) => {
    // On failure attach a fresh screenshot + DB snapshots of both slugs so
    // CI artifacts contain everything needed to diagnose a resurrection.
    if (testInfo.status !== testInfo.expectedStatus) {
      try {
        const shot = await page.screenshot();
        await testInfo.attach("failure-screenshot.png", {
          body: shot,
          contentType: "image/png",
        });
      } catch {
        /* page may already be closed */
      }
      try {
        const [oldRow, newRow] = await Promise.all([
          snapshotSlugRow(oldSlug),
          snapshotSlugRow(newSlug),
        ]);
        await testInfo.attach("db-snapshot.json", {
          body: JSON.stringify({ oldSlug, newSlug, oldRow, newRow }, null, 2),
          contentType: "application/json",
        });
      } catch {
        /* ignore */
      }
    }
    await deleteNote(oldSlug).catch(() => {});
    await deleteNote(newSlug).catch(() => {});
  });

  test("renames after pending Yjs edits and old slug stays gone after debounce", async ({
    page,
  }, testInfo) => {
    const consoleLines: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`));

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
    // delete. Wait beyond both, then poll the DB.
    await page.waitForTimeout(2_000);

    const lingering = await waitForSlugAbsent(oldSlug, { timeoutMs: 5_000, intervalMs: 200 });
    if (lingering) {
      await testInfo.attach("old-slug-snapshot.json", {
        body: JSON.stringify(lingering, null, 2),
        contentType: "application/json",
      });
      await testInfo.attach("browser-console.log", {
        body: consoleLines.join("\n"),
        contentType: "text/plain",
      });
      await testInfo.attach("page-errors.log", {
        body: pageErrors.join("\n"),
        contentType: "text/plain",
      });
    }
    expect(lingering, "old slug row was resurrected after rename").toBeNull();

    const newRow = await snapshotSlugRow(newSlug);
    expect(newRow, "new slug row missing").not.toBeNull();
    await expect(page).toHaveURL(new RegExp(`/${newSlug}$`));
  });
});
