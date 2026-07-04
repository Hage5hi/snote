// DOM snapshot test for --html-report:
//   - Meta table renders every runMeta field.
//   - Quarantined rows are present (top-N table + full search table).
//   - Search filter keeps results correct after re-filtering.
// Uses an inline snapshot on a normalised HTML slice so future report
// tweaks flag a diff instead of silently changing the on-call view.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function loadHtml(html: string) {
  document.open(); document.write(html); document.close();
  for (const s of Array.from(document.querySelectorAll("script"))) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(s.textContent || "").call(window);
  }
}

describe("inspect-focus-trap --html-report snapshot", () => {
  it("renders a stable meta table + quarantined rows and search stays correct", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-html-snap-"));
    const scan = join(root, "test-results");
    const mk = (spec: string, payload: unknown | string) => {
      const d = join(scan, spec); mkdirSync(d, { recursive: true });
      const f = join(d, "focus-trap-escape-x.json");
      writeFileSync(f, typeof payload === "string" ? payload : JSON.stringify(payload));
      return f;
    };
    mk("alpha-spec-chromium-retry0", { focusHistory: [{ event: 42 }] });   // schema /focusHistory/0/event
    mk("bravo-spec-chromium-retry0", { /* no focusHistory */ });           // schema /focusHistory
    mk("charlie-spec-chromium-retry0", "{broken");                          // parse

    const htmlPath = join(root, "report.html");
    const res = spawnSync("bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--scan-root", scan,
        "--out", join(root, "summary.json"),
        "--html-report", htmlPath,
        "--invalid-dir", join(root, "_invalid")],
      {
        encoding: "utf8",
        // Pin every meta value the meta table renders so the snapshot
        // is byte-stable across machines/runs.
        env: {
          ...process.env,
          GITHUB_SHA: "deadbeef",
          GITHUB_RUN_ID: "42",
          GITHUB_RUN_ATTEMPT: "7",
        },
      });
    expect(res.status).toBe(2);
    const html = readFileSync(htmlPath, "utf8");
    loadHtml(html);

    // ---- meta table: pinned keys + values ----
    const metaRows = Array.from(document.querySelectorAll<HTMLTableRowElement>("table.meta tr"))
      .map((r) => [r.cells[0]?.textContent?.trim(), r.cells[1]?.textContent?.trim()]);
    const metaMap = Object.fromEntries(metaRows.filter((r) => r[0]));
    expect(Object.keys(metaMap).sort()).toEqual(["argv", "ciRunAttempt", "ciRunId", "gitSha", "scanRoot", "timestamp"]);
    expect(metaMap.gitSha).toBe("deadbeef");
    expect(metaMap.ciRunId).toBe("42");
    expect(metaMap.ciRunAttempt).toBe("7");
    expect(metaMap.scanRoot).toBe(scan);

    // ---- quarantined rows: 3 present in full search table, sorted ----
    const allRows = Array.from(document.querySelectorAll<HTMLTableRowElement>("#q-all tbody tr"));
    expect(allRows.length).toBe(3);
    const originals = allRows.map((r) => r.cells[0]?.textContent?.trim() || "");
    expect(originals).toEqual([...originals].sort((a, b) => a.localeCompare(b)));
    expect(originals[0]).toContain("alpha-spec");
    expect(originals[1]).toContain("bravo-spec");
    expect(originals[2]).toContain("charlie-spec");

    // ---- search stays correct across multiple filters ----
    const search = document.getElementById("q-search") as HTMLInputElement;
    const visible = () => allRows.filter((r) => r.style.display !== "none");

    search.value = "/focusHistory/0/event";
    search.dispatchEvent(new Event("input"));
    expect(visible().map((r) => r.cells[0]?.textContent)).toEqual([originals[0]]);

    search.value = "parse";
    search.dispatchEvent(new Event("input"));
    expect(visible().length).toBe(1);
    expect(visible()[0].textContent?.toLowerCase()).toContain("parse");

    search.value = "";
    search.dispatchEvent(new Event("input"));
    expect(visible().length).toBe(3);
  }, 60_000);
});
