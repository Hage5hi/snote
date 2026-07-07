// Multi-tab observer: Tab A performs the rename. Tab B is a passive observer
// on the old slug that must never resurrect the old-slug row after the Yjs
// debounce window elapses.
import { test, expect } from "@playwright/test";
import { deleteNote, seedPlaintextNote, versionedSlug } from "./helpers/seed-note";
import { fetchOldSlugCleanupStatus, verifyOldSlugGoneWithRetry } from "./helpers/db-assert";

const TEXT = "Multi-tab observer content";

test.use({ trace: "on", video: "on", screenshot: "only-on-failure" });

test.describe("multi-tab rename observer", () => {
  let oldSlug: string;
  let newSlug: string;

  test.beforeEach(async () => {
    oldSlug = versionedSlug("mto-old");
    newSlug = versionedSlug("mto-new");
    await deleteNote(oldSlug).catch(() => {});
    await deleteNote(newSlug).catch(() => {});
    await seedPlaintextNote(oldSlug, TEXT);
  });

  test.afterEach(async () => {
    await deleteNote(oldSlug).catch(() => {});
    await deleteNote(newSlug).catch(() => {});
  });

  test("tab B never observes old slug resurrection after tab A renames", async ({ context }, testInfo) => {
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const logs: string[] = [];
    tabA.on("console", (m) => logs.push(`[A:${m.type()}] ${m.text()}`));
    tabB.on("console", (m) => logs.push(`[B:${m.type()}] ${m.text()}`));

    await tabA.goto(`/${oldSlug}`);
    await tabB.goto(`/${oldSlug}`);
    await expect(tabA.locator(".cm-content").first()).toContainText(TEXT, { timeout: 15_000 });
    await expect(tabB.locator(".cm-content").first()).toContainText(TEXT, { timeout: 15_000 });

    console.log("[multi-tab] rename begin", { oldSlug, newSlug });
    await tabA.getByRole("button", { name: /^note/i }).click();
    await tabA.getByRole("menuitem", { name: /rename/i }).click();
    const dialog = tabA.getByRole("dialog");
    await dialog.getByPlaceholder(/new-slug|slug/i).fill(newSlug);
    await dialog.getByRole("button", { name: /^rename$/i }).click();
    await tabA.waitForURL(new RegExp(`/${newSlug}$`), { timeout: 15_000 });
    console.log("[multi-tab] rename committed on A", { oldSlug, newSlug });

    // Give broadcast + Yjs debounce time to settle in tab B.
    await tabB.waitForTimeout(2_500);
    const status = await fetchOldSlugCleanupStatus(tabB, oldSlug).catch((e) => ({ error: String(e) }));
    console.log("[multi-tab] tabB cleanup-status", { oldSlug, newSlug, status });

    const lingering = await verifyOldSlugGoneWithRetry(tabB, oldSlug, {
      timeoutMs: 5_000,
      intervalMs: 200,
      forbiddenText: TEXT,
      postRevisitTimeoutMs: 3_000,
      attempts: 4,
      backoffMs: 500,
      label: "tabB-observer",
    });
    if (lingering) {
      await testInfo.attach("multi-tab-console.log", { body: logs.join("\n"), contentType: "text/plain" });
      await testInfo.attach("multi-tab-lingering.json", {
        body: JSON.stringify({ oldSlug, newSlug, lingering, status }, null, 2),
        contentType: "application/json",
      });
    }
    expect(lingering, "tab B observed old-slug resurrection after tab A rename").toBeNull();

    await tabA.close();
    await tabB.close();
  });
});
