// E2E: renaming a note after local edits must not let the old Yjs provider's
// debounced snapshot recreate the deleted old slug row.
//
// On failure this spec attaches:
//   - browser console + page errors captured during the run
//   - a DB snapshot of the old slug row (so resurrections are trivial to spot)
//   - Playwright's own trace/video (see playwright.config.ts `retain-on-failure`)

import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { deleteNote, seedPlaintextNote, versionedSlug } from "./helpers/seed-note";
import { snapshotSlugRow, verifyOldSlugGoneFromDbAndUi } from "./helpers/db-assert";

const TEXT = "Rename race content";

async function attachDiagnostics(
  testInfo: TestInfo,
  page: Page,
  name: string,
  payload: unknown,
) {
  await testInfo.attach(`${name}.json`, {
    body: JSON.stringify(payload, null, 2),
    contentType: "application/json",
  });
  try {
    await testInfo.attach(`${name}.png`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } catch {
    /* page may already be closed */
  }
}

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
    context,
  }, testInfo) => {
    const consoleLines: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`));

    await page.goto(`/${oldSlug}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    const oldTab = await context.newPage();
    const oldTabConsole: string[] = [];
    oldTab.on("console", (msg) => oldTabConsole.push(`[${msg.type()}] ${msg.text()}`));
    await oldTab.goto(`/${oldSlug}`);
    const oldTabEditor = oldTab.locator(".cm-content").first();
    await expect(oldTabEditor).toContainText(TEXT, { timeout: 15_000 });

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

    const newRow = await snapshotSlugRow(newSlug);
    expect(newRow, "new slug row missing").not.toBeNull();
    await expect(page).toHaveURL(new RegExp(`/${newSlug}$`));

    // Wait beyond the provider debounce/finalize window, then poll DB + UI.
    await page.waitForTimeout(2_000);

    const lingering = await verifyOldSlugGoneFromDbAndUi(page, oldSlug, {
      timeoutMs: 5_000,
      intervalMs: 200,
      forbiddenText: `${TEXT} pending edit`,
      postRevisitTimeoutMs: 3_000,
    });
    if (lingering) {
      await attachDiagnostics(testInfo, page, "old-slug-resurrection", lingering);
      await testInfo.attach("browser-console.log", {
        body: consoleLines.join("\n"),
        contentType: "text/plain",
      });
      await testInfo.attach("old-tab-console.log", {
        body: oldTabConsole.join("\n"),
        contentType: "text/plain",
      });
      await testInfo.attach("page-errors.log", {
        body: pageErrors.join("\n"),
        contentType: "text/plain",
      });
    }
    expect(lingering, "old slug row/UI was resurrected after rename").toBeNull();

    await oldTab.waitForTimeout(1_000);
    const oldTabLingering = await verifyOldSlugGoneFromDbAndUi(oldTab, oldSlug, {
      timeoutMs: 3_000,
      intervalMs: 200,
      forbiddenText: TEXT,
      postRevisitTimeoutMs: 3_000,
    });
    if (oldTabLingering) await attachDiagnostics(testInfo, oldTab, "old-tab-resurrection", oldTabLingering);
    expect(oldTabLingering, "old tab recreated old slug after broadcast").toBeNull();
    await oldTab.close();
  });
});

test.describe("cross-tab rename abandonment", () => {
  let oldSlug: string;
  let newSlug: string;

  test.beforeEach(async () => {
    oldSlug = versionedSlug("cross-old");
    newSlug = versionedSlug("cross-new");
    await deleteNote(oldSlug).catch(() => {});
    await deleteNote(newSlug).catch(() => {});
    await seedPlaintextNote(oldSlug, TEXT);
  });

  test.afterEach(async () => {
    await deleteNote(oldSlug).catch(() => {});
    await deleteNote(newSlug).catch(() => {});
  });

  test("renaming in one tab abandons provider in another tab via broadcast", async ({ context }, testInfo) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    const consoleLines: string[] = [];
    page1.on("console", (msg) => consoleLines.push(`[tab1:${msg.type()}] ${msg.text()}`));
    page2.on("console", (msg) => consoleLines.push(`[tab2:${msg.type()}] ${msg.text()}`));

    // Both tabs on the same note
    await page1.goto(`/${oldSlug}`);
    await page2.goto(`/${oldSlug}`);
    
    const editor1 = page1.locator(".cm-content").first();
    const editor2 = page2.locator(".cm-content").first();
    await expect(editor1).toContainText(TEXT);
    await expect(editor2).toContainText(TEXT);

    // Rename in Tab 1
    await page1.getByRole("button", { name: /^note/i }).click();
    await page1.getByRole("menuitem", { name: /rename/i }).click();
    const dialog = page1.getByRole("dialog");
    await dialog.getByPlaceholder(/new-slug|slug/i).fill(newSlug);
    await dialog.getByRole("button", { name: /^rename$/i }).click();

    await page1.waitForURL(new RegExp(`/${newSlug}$`));

    // Tab 2 should now be abandoned. If we type in it, it should NOT recreate oldSlug.
    await editor2.click();
    await page2.keyboard.type(" dead edit");
    
    // Wait for debounce
    await page2.waitForTimeout(2000);

    const lingering = await verifyOldSlugGoneFromDbAndUi(page2, oldSlug, {
      timeoutMs: 5_000,
      intervalMs: 200,
      forbiddenText: `${TEXT} dead edit`,
      postRevisitTimeoutMs: 3_000,
    });
    if (lingering) {
      await attachDiagnostics(testInfo, page2, "cross-tab-old-slug-resurrection", lingering);
      await testInfo.attach("cross-tab-console.log", {
        body: consoleLines.join("\n"),
        contentType: "text/plain",
      });
    }
    expect(lingering, "old slug resurrected by stale tab").toBeNull();
    await page1.close();
    await page2.close();
  });
});
