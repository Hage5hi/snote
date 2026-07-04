// --report-validate-only:
//   - Well-formed run → exit 0 AND no --json-report / --diff-out artifacts
//     are written to disk.
//   - Malformed report / diff-out header → the shared validators return
//     errors so the CLI's process.exit(65) path fires. Verified as unit
//     tests against the helpers to avoid having to mutate CLI internals.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_DIFF_CSV_COLUMNS,
  validateDiffCsvHeader,
  validateJsonReport,
} from "../_helpers/focus-trap-inspect";

describe("inspect-focus-trap --report-validate-only", () => {
  it("exits 0 and does NOT write --json-report, --diff-out, or --html-report", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-rvo-"));
    const scan = join(root, "test-results");
    const spec = join(scan, "a-spec-chromium-retry0");
    mkdirSync(spec, { recursive: true });
    // One healthy artifact so the run is well-formed.
    writeFileSync(join(spec, "focus-trap-escape-x.json"), JSON.stringify({ focusHistory: [{ event: "keydown" }] }));

    // Seed a "previous run" so --diff-with has data to compare against.
    const prev = join(root, "prev");
    mkdirSync(prev, { recursive: true });
    writeFileSync(join(prev, "focus-trap-inspect-summary.valid.csv"), "file,failureReason\n");

    const jsonReport = join(root, "report.json");
    const diffOut = join(root, "diff.csv");
    const diffJsonOut = join(root, "diff.json");
    const htmlReport = join(root, "report.html");
    const summaryOut = join(root, "summary.json");
    const csvOut = join(root, "rows.csv");
    const mdOut = join(root, "notes.md");

    const res = spawnSync(
      "bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--scan-root", scan,
        "--out", summaryOut,
        "--csv", csvOut,
        "--md", mdOut,
        "--json-report", jsonReport,
        "--diff-with", prev,
        "--diff-out", diffOut,
        "--diff-json-out", diffJsonOut,
        "--html-report", htmlReport,
        "--invalid-dir", join(root, "_invalid"),
        "--report-validate-only"],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(0);
    // None of the artifact outputs may be written in validate-only mode.
    for (const p of [jsonReport, diffOut, diffJsonOut, htmlReport, summaryOut, csvOut, mdOut]) {
      expect(existsSync(p), `unexpected write: ${p}`).toBe(false);
    }
  }, 60_000);

  it("flags malformed --json-report shapes (missing top keys / artifact keys)", () => {
    expect(validateJsonReport({}).length).toBeGreaterThan(0);
    expect(validateJsonReport({
      generatedAt: "t", meta: {}, scanned: 0, matched: 0, valid: 0, invalid: 0,
      artifacts: [{ file: "a.json" /* missing failureKind/failureReason/... */ }],
      issues: [],
    }).some((m) => /artifacts\[0\]/.test(m))).toBe(true);
  });

  it("flags malformed --diff-out CSV headers (missing / reordered)", () => {
    expect(validateDiffCsvHeader(["file", "failureReason"]).length).toBeGreaterThan(0);
    // Reorder → still flagged even though every required column is present.
    const reordered = [...REQUIRED_DIFF_CSV_COLUMNS].reverse();
    expect(validateDiffCsvHeader(reordered).length).toBeGreaterThan(0);
  });
});
