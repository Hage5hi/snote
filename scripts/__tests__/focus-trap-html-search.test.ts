// e2e-style test for --html-report client-side search:
//   1. Run the CLI to produce a real HTML report containing several
//      quarantined rows with distinct failureReason / schemaPointer values.
//   2. Load the HTML into JSDOM, execute its inline <script>, dispatch
//      an 'input' event on #q-search, and assert only matching rows in
//      the full quarantined table stay visible.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// vitest uses jsdom globally (see vitest.config.ts), so `document` /
// `window` in this test are a fresh JSDOM document.
function loadHtml(html: string) {
  document.open();
  document.write(html);
  document.close();
  // Execute inline scripts (JSDOM via document.write skips them by design).
  for (const s of Array.from(document.querySelectorAll("script"))) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(s.textContent || "").call(window);
  }
}

describe("inspect-focus-trap --html-report client-side search", () => {
  it("filters the full quarantined table by failureReason and schemaPointer", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-html-search-"));
    const scan = join(root, "test-results");

    // Two schema failures at distinct pointers + one parse failure so
    // we have three quarantined rows with different failureReason /
    // schemaPointer text to filter on.
    const mk = (spec: string, payload: unknown | string) => {
      const d = join(scan, spec);
      mkdirSync(d, { recursive: true });
      const f = join(d, "focus-trap-escape-x.json");
      writeFileSync(f, typeof payload === "string" ? payload : JSON.stringify(payload));
      return f;
    };
    mk("alpha-spec-chromium-retry0", { focusHistory: [{ event: 42 }] });          // schema /focusHistory/0/event
    mk("bravo-spec-chromium-retry0", { /* no focusHistory */ });                  // schema /focusHistory
    mk("charlie-spec-chromium-retry0", "{broken json");                            // parse error

    const htmlPath = join(root, "report.html");
    const res = spawnSync(
      "bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--scan-root", scan,
        "--out", join(root, "summary.json"),
        "--html-report", htmlPath,
        "--invalid-dir", join(root, "_invalid")],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(2);
    const html = readFileSync(htmlPath, "utf8");
    expect(html).toContain('id="q-search"');

    loadHtml(html);
    const search = document.getElementById("q-search") as HTMLInputElement;
    const rows = () => Array.from(document.querySelectorAll<HTMLTableRowElement>("#q-all tbody tr"));
    const visibleText = () => rows().filter((r) => r.style.display !== "none").map((r) => r.textContent || "");

    // Baseline: all three quarantined rows visible.
    expect(rows().length).toBe(3);
    expect(visibleText().length).toBe(3);

    // Filter by a schemaPointer substring — only that row remains.
    search.value = "/focusHistory/0/event";
    search.dispatchEvent(new Event("input"));
    const afterPtr = visibleText();
    expect(afterPtr.length).toBe(1);
    expect(afterPtr[0]).toContain("/focusHistory/0/event");

    // Filter by a failureReason substring ("parse") — only parse row remains.
    search.value = "parse";
    search.dispatchEvent(new Event("input"));
    const afterReason = visibleText();
    expect(afterReason.length).toBe(1);
    expect(afterReason[0].toLowerCase()).toContain("parse");

    // Empty query restores all rows.
    search.value = "";
    search.dispatchEvent(new Event("input"));
    expect(visibleText().length).toBe(3);
  }, 60_000);
});
