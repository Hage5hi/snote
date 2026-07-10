// E2E: on URL sanitize mismatch, unconditionally capture screenshot + trace
// (independent of the global "only-on-failure" defaults) and assert the
// reason surfaced in UrlSanitizeDebugPanel matches the expected stripped
// param list. Makes triage of cache-buster regressions one-click.
import { expect, test } from "@playwright/test";
import path from "node:path";

const OUT_DIR = path.resolve("test-results", "url-sanitize-mismatch");

test.describe("url-sanitize mismatch capture", () => {
  // Force trace on for this suite regardless of global "retain-on-failure".
  test.use({ trace: "on" });

  test("mismatch: captures screenshot, trace, and asserts stripped reason", async ({
    page,
  }, testInfo) => {
    const consoleEvents: unknown[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "info") return;
      if (!msg.text().includes("[url-sanitize:event]")) return;
      // Structured event args are the second console arg (see panel).
      Promise.all(msg.args().map((a) => a.jsonValue().catch(() => null)))
        .then((vals) => consoleEvents.push(vals[1]))
        .catch(() => {});
    });

    await page.goto("/my-note?foo=bar&v=123&ver=2&t=999&cb=x");

    const panel = page.locator('[data-url-sanitize-debug-panel="true"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Screenshot captured unconditionally + attached to the HTML report.
    const shotPath = path.join(OUT_DIR, `${testInfo.title.replace(/\s+/g, "_")}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    await testInfo.attach("url-sanitize-mismatch-screenshot", {
      path: shotPath,
      contentType: "image/png",
    });

    // Assert the reason banner — original ≠ sanitized AND the removed list
    // matches the cache-busters we sent, in order.
    const firstEvent = panel.locator("[data-strip-event]").first();
    await expect(firstEvent).toContainText("original:");
    await expect(firstEvent).toContainText("/my-note?foo=bar&v=123&ver=2&t=999&cb=x");
    await expect(firstEvent).toContainText("sanitized:");
    await expect(firstEvent).toContainText("/my-note?foo=bar");
    await expect(firstEvent).toContainText(/removed:.*v.*ver.*t.*cb/);

    // Cross-check the structured console event so a future UI-render bug can't
    // mask the actual sanitize decision.
    await expect
      .poll(() => consoleEvents.length, { timeout: 2_000 })
      .toBeGreaterThan(0);
    const evt = consoleEvents[0] as {
      original: string;
      sanitized: string;
      removed: string[];
    };
    expect(evt.original).not.toBe(evt.sanitized);
    expect(evt.removed).toEqual(expect.arrayContaining(["v", "ver", "t", "cb"]));

    // Attach a small artifact bundle (JSON) summarising the mismatch so the
    // Playwright HTML report links screenshot + trace + bundle together.
    const bundle = {
      title: testInfo.title,
      screenshot: shotPath,
      reason: {
        original: evt.original,
        sanitized: evt.sanitized,
        removed: evt.removed,
      },
    };
    await testInfo.attach("url-sanitize-mismatch-bundle.json", {
      body: Buffer.from(JSON.stringify(bundle, null, 2)),
      contentType: "application/json",
    });

    // Verify the attachments were actually recorded on this test result — a
    // regression that drops screenshot/trace attachments would fail here
    // rather than silently producing empty triage artifacts.
    const names = testInfo.attachments.map((a) => a.name);
    expect(names).toContain("url-sanitize-mismatch-screenshot");
    expect(names).toContain("url-sanitize-mismatch-bundle.json");
  });
});
