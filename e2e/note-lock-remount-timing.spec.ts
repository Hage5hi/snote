// E2E: measure Yjs provider remount timing during lock/unlock and fail if
// the editor stays editable longer than an empirically-tuned threshold.
//
// Threshold history:
//   - Initial: 1500ms — too tight; flaked on WebKit CI (~1.7s p95) and
//     Firefox cold-start (~1.9s p95).
//   - Current: 2500ms — comfortably above recorded p99 (~2.1s) across
//     chromium/firefox/webkit, still tight enough that a real regression
//     (remount on a macrotask chain, ~4s+) fails deterministically.
//
// On failure, the assertion attaches a per-poll sample log so the reviewer
// can see WHEN the editor flipped and which polls still saw editable state.

import { test, expect } from "@playwright/test";
import { deleteNote, seedPlaintextNote } from "./helpers/seed-note";
import { uniqueSlug } from "./helpers/note-writes";

// Always retain artifacts for this timing-sensitive spec, so regressions are
// debuggable from the first failed CI run without a re-run.
test.use({ trace: "on", video: "on", screenshot: "only-on-failure" });

const PASSPHRASE = "correct-horse-battery-staple";
const TEXT = "Remount timing probe.";

const MAX_EDITABLE_WINDOW_MS = 2_500;

test.describe("provider remount timing", () => {
  let slug: string;

  test.beforeEach(async () => {
    slug = uniqueSlug("timing");
    await seedPlaintextNote(slug, TEXT);
  });

  test.afterEach(async () => {
    await deleteNote(slug).catch(() => {});
  });

  test("editor becomes non-editable within threshold on lock", async ({
    page,
  }, testInfo) => {
    await page.goto(`/${slug}`);
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });

    await page.getByRole("button", { name: /encrypt/i }).click();
    await page.getByPlaceholder(/pass/i).first().fill(PASSPHRASE);

    // Per-poll diagnostic samples — attached on failure.
    const samples: { tMs: number; editableCount: number }[] = [];
    const started = Date.now();
    await page.getByRole("button", { name: /^encrypt$/i }).click();

    await expect
      .poll(
        async () => {
          const editableCount = await page
            .locator(".cm-content[contenteditable='true']")
            .count();
          samples.push({ tMs: Date.now() - started, editableCount });
          return editableCount;
        },
        { timeout: MAX_EDITABLE_WINDOW_MS + 500, intervals: [25, 50, 100] },
      )
      .toBe(0);

    const elapsed = Date.now() - started;
    const report = {
      elapsedMs: elapsed,
      thresholdMs: MAX_EDITABLE_WINDOW_MS,
      samples,
      overThreshold: elapsed > MAX_EDITABLE_WINDOW_MS,
    };
    // Always attach so the report is present in traces even on pass, making
    // "how close were we to the limit?" trivially answerable.
    await testInfo.attach("remount-timing-report.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });

    expect(
      elapsed,
      `Editor stayed editable for ${elapsed}ms during remount ` +
        `(max ${MAX_EDITABLE_WINDOW_MS}ms). Samples:\n` +
        JSON.stringify(samples, null, 2),
    ).toBeLessThanOrEqual(MAX_EDITABLE_WINDOW_MS);

    await page.waitForURL(new RegExp(`/${slug}#`), { timeout: 15_000 });
    await expect(editor).toContainText(TEXT, { timeout: 15_000 });
  });
});
