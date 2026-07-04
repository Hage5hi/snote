// Integration test for scripts/inspect-focus-trap.ts --diff-with:
// seeds a "previous run" as CSVs (matching the shape produced by
// --csv-filter valid|invalid) plus a set of current artifacts, then
// asserts the diff detects changes in failureReason AND schemaPointer,
// and that --diff-out is a stable, sorted CSV with the pinned header.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CSV_COLUMNS } from "../_helpers/focus-trap-inspect";

// Build a minimal prev-run CSV row matching CSV_COLUMNS order. Only the
// file + failureReason columns are read by --diff-with; the rest is
// padding so column indices line up.
function csvRow(file: string, failureReason: string): string {
  return CSV_COLUMNS.map((c) => {
    if (c === "file") return file;
    if (c === "failureReason") {
      // Match escCsv rules so the diff reads back the same value.
      return /[",\n\r]/.test(failureReason) ? `"${failureReason.replace(/"/g, '""')}"` : failureReason;
    }
    return "";
  }).join(",");
}

describe("inspect-focus-trap --diff-with / --diff-out", () => {
  it("detects failureReason and schemaPointer changes and writes a stable CSV diff", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-diff-"));
    const artifactsRoot = join(root, "test-results");

    // ---- current run artifacts (3 files) ----
    const mk = (spec: string, payload: unknown | string) => {
      const dir = join(artifactsRoot, spec);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, "focus-trap-escape-x.json");
      writeFileSync(file, typeof payload === "string" ? payload : JSON.stringify(payload));
      return file;
    };
    const fUnchanged = mk("a-spec-chromium-retry0", { focusHistory: [{ event: "keydown" }] });          // was healthy, still healthy
    const fPointerChanged = mk("b-spec-chromium-retry0", { focusHistory: [{ event: 42 }] });             // was healthy → schema fail
    const fReasonChanged  = mk("c-spec-chromium-retry0", "{broken json");                                // was schema fail → parse fail

    // ---- prev run CSVs (valid + invalid) ----
    const prevDir = join(root, "prev");
    mkdirSync(prevDir, { recursive: true });
    const validCsv = [CSV_COLUMNS.join(","), csvRow(fUnchanged, ""), csvRow(fPointerChanged, "")].join("\n") + "\n";
    const invalidCsv = [CSV_COLUMNS.join(","), csvRow(fReasonChanged, "schema: /focusHistory [focusHistory]: required array")].join("\n") + "\n";
    writeFileSync(join(prevDir, "focus-trap-inspect-summary.valid.csv"), validCsv);
    writeFileSync(join(prevDir, "focus-trap-inspect-summary.invalid.csv"), invalidCsv);

    const outJson = join(root, "summary.json");
    const diffOut = join(root, "diff.csv");
    const res = spawnSync(
      "bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--scan-root", artifactsRoot,
        "--out", outJson,
        "--diff-with", prevDir,
        "--diff-out", diffOut,
        "--invalid-dir", join(root, "_invalid")],
      { encoding: "utf8" },
    );
    // Two invalid → exit 2.
    expect(res.status).toBe(2);

    const csv = readFileSync(diffOut, "utf8");
    const lines = csv.trim().split("\n");
    // Pinned header.
    expect(lines[0]).toBe("file,prevFailureReason,prevSchemaPointer,currFailureReason,currSchemaPointer");
    // Exactly 2 changed rows (the healthy → healthy file must not appear).
    expect(lines.length).toBe(3);
    expect(csv).not.toContain(fUnchanged);

    // Rows are sorted by file path.
    const dataRows = lines.slice(1);
    const files = dataRows.map((r) => r.split(",")[0]);
    expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b)));

    // Row for b-spec: prev healthy ("") → curr schema pointer set.
    const bRow = dataRows.find((r) => r.startsWith(fPointerChanged))!;
    const bCells = bRow.split(",");
    expect(bCells[1]).toBe("");                          // prevFailureReason
    expect(bCells[2]).toBe("");                          // prevSchemaPointer
    expect(bCells[3]).toMatch(/^"?schema:/);             // currFailureReason begins with schema:
    expect(bRow).toContain("/focusHistory/0/event");     // currSchemaPointer

    // Row for c-spec: prev schema → curr parse (reason changes even
    // though both are "invalid").
    const cRow = dataRows.find((r) => r.startsWith(fReasonChanged))!;
    expect(cRow).toContain("schema:");
    expect(cRow).toContain("/focusHistory");
    expect(cRow).toMatch(/parse( error)?:/);


    // Re-running with identical inputs produces byte-identical CSV.
    const res2 = spawnSync(
      "bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--scan-root", artifactsRoot, "--out", outJson,
        "--diff-with", prevDir, "--diff-out", diffOut,
        "--invalid-dir", join(root, "_invalid")],
      { encoding: "utf8" },
    );
    expect(res2.status).toBe(2);
    expect(readFileSync(diffOut, "utf8")).toBe(csv);
  }, 60_000);
});
