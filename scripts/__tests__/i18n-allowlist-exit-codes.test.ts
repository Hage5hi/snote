// Pins two contracts that downstream CI depends on:
//
//   1. Schema annotations carry the EXACT per-line schema error message
//      appended to the aggregate reason. Drift annotations don't (their
//      reason is already the complete story).
//
//   2. The CLI exit code distinguishes failure causes:
//        • 0 — pass
//        • 2 — schema validation failed (even when drift is also broken)
//        • 1 — drift (missing/stale) or any other non-schema failure
//
// Both are tested through the pure helpers (`formatAnnotations`,
// `exitCodeFor`, `toJSON`) so we don't have to spawn the CLI.
import { describe, expect, it } from "vitest";
import {
  buildSummary,
  exitCodeFor,
  formatAnnotations,
  toJSON,
  type AllowlistReport,
} from "../i18n-allowlist-report";

const REPORT_PATH = "reports/i18n-allowlist-report.json";

function emptyReport(over: Partial<AllowlistReport> = {}): AllowlistReport {
  return {
    ok: true,
    schemaOk: true,
    driftOk: true,
    totals: { entries: 0, schemaErrors: 0, missing: 0, stale: 0 },
    entries: [],
    missing: [],
    stale: [],
    ...over,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Schema annotation message contract
// ────────────────────────────────────────────────────────────────────────────
describe("formatAnnotations — schema messages", () => {
  const schemaReport: AllowlistReport = {
    ok: false,
    schemaOk: false,
    driftOk: true,
    totals: { entries: 2, schemaErrors: 2, missing: 0, stale: 0 },
    entries: [
      {
        index: 0,
        file: "src/a.tsx",
        reason: "x",
        errors: ["must contain property `reason`"],
        matchedSites: [],
      },
      {
        index: 1,
        file: "src/b.tsx",
        reason: "y",
        errors: ["unknown key `whoops`", "second error ignored"],
        matchedSites: [],
      },
    ],
    missing: [],
    stale: [],
  };

  it("appends the exact first schema error to each annotated line", () => {
    const s = buildSummary(schemaReport, REPORT_PATH, {
      entryLineLookup: (i) => (i === 0 ? 10 : 25),
    });
    const anns = formatAnnotations(s);
    expect(anns).toHaveLength(2);

    // Annotation 0 → entry 0, line 10, message #1
    expect(anns[0]).toContain("file=.lintrc-i18n-allowlist.json,line=10");
    expect(anns[0]).toContain("must contain property `reason`");
    // Aggregate reason still present before the appended specific message.
    expect(anns[0]).toMatch(/schema validation failed.* — must contain property/);

    // Annotation 1 → entry 1, line 25, message #1 only (extra errors ignored)
    expect(anns[1]).toContain("file=.lintrc-i18n-allowlist.json,line=25");
    expect(anns[1]).toContain("unknown key `whoops`");
    expect(anns[1]).not.toContain("second error ignored");
  });

  it("falls back to file-only annotation when no line lookup is available", () => {
    const s = buildSummary(schemaReport, REPORT_PATH);
    const anns = formatAnnotations(s);
    // Both entries collapse to the same file; uniqWithMessages dedupes.
    expect(anns).toHaveLength(1);
    expect(anns[0]).toContain("file=.lintrc-i18n-allowlist.json");
    expect(anns[0]).not.toMatch(/line=/);
    // First entry's message wins after dedupe.
    expect(anns[0]).toContain("must contain property `reason`");
  });

  it("escapes newlines/percent in the appended schema message", () => {
    const r: AllowlistReport = {
      ...schemaReport,
      entries: [
        {
          index: 0,
          file: "src/a.tsx",
          reason: "x",
          errors: ["bad %s\nsecond line"],
          matchedSites: [],
        },
      ],
      totals: { ...schemaReport.totals, entries: 1, schemaErrors: 1 },
    };
    const s = buildSummary(r, REPORT_PATH, { entryLineLookup: () => 4 });
    const [ann] = formatAnnotations(s);
    expect(ann).toContain("%25s");
    expect(ann).toContain("%0Asecond line");
  });

  it("drift-missing annotations carry only the aggregate reason (no per-line message)", () => {
    const r: AllowlistReport = {
      ok: false,
      schemaOk: true,
      driftOk: false,
      totals: { entries: 0, schemaErrors: 0, missing: 1, stale: 0 },
      entries: [],
      missing: [{ file: "src/widget.tsx", reason: "ad-hoc", line: 42 }],
      stale: [],
    };
    const [ann] = formatAnnotations(buildSummary(r, REPORT_PATH));
    expect(ann).toContain("file=src/widget.tsx,line=42");
    expect(ann).toContain("drift (missing)");
    // No `— <specific>` suffix because topMessages is null for drift.
    expect(ann).not.toMatch(/— [^—]+ — /);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Exit code contract
// ────────────────────────────────────────────────────────────────────────────
describe("exitCodeFor — schema=2, drift=1, pass=0", () => {
  it("returns 0 for a passing report", () => {
    const s = buildSummary(emptyReport(), REPORT_PATH);
    expect(exitCodeFor(s)).toBe(0);
    expect(toJSON(s).exitCode).toBe(0);
  });

  it("returns 2 for schema-only failure", () => {
    const r = emptyReport({
      ok: false,
      schemaOk: false,
      totals: { entries: 1, schemaErrors: 1, missing: 0, stale: 0 },
      entries: [
        { index: 0, file: "src/a.tsx", reason: "x", errors: ["nope"], matchedSites: [] },
      ],
    });
    expect(exitCodeFor(buildSummary(r, REPORT_PATH))).toBe(2);
  });

  it("returns 1 for drift-missing-only failure", () => {
    const r = emptyReport({
      ok: false,
      driftOk: false,
      totals: { entries: 0, schemaErrors: 0, missing: 1, stale: 0 },
      missing: [{ file: "src/x.tsx", reason: "r", line: 1 }],
    });
    expect(exitCodeFor(buildSummary(r, REPORT_PATH))).toBe(1);
  });

  it("returns 1 for drift-stale-only failure", () => {
    const r = emptyReport({
      ok: false,
      driftOk: false,
      totals: { entries: 0, schemaErrors: 0, missing: 0, stale: 1 },
      stale: ["src/old.tsx::r"],
    });
    expect(exitCodeFor(buildSummary(r, REPORT_PATH))).toBe(1);
  });

  it("schema wins when BOTH schema and drift fail simultaneously", () => {
    const r = emptyReport({
      ok: false,
      schemaOk: false,
      driftOk: false,
      totals: { entries: 1, schemaErrors: 1, missing: 2, stale: 3 },
      entries: [
        { index: 0, file: "src/a.tsx", reason: "x", errors: ["bad"], matchedSites: [] },
      ],
      missing: [
        { file: "src/x.tsx", reason: "r", line: 1 },
        { file: "src/y.tsx", reason: "r", line: 2 },
      ],
      stale: ["src/old.tsx::r", "src/old2.tsx::r", "src/old3.tsx::r"],
    });
    const s = buildSummary(r, REPORT_PATH);
    expect(exitCodeFor(s)).toBe(2);
    expect(toJSON(s).exitCode).toBe(2);
    // And the failure category surfaced is schema (not drift).
    expect(s.failure?.category).toBe("schema");
  });

  it("scoped --changed result that hides schema errors still exits 2 (schema is global)", () => {
    // Schema validity is global to the allowlist JSON — scoping the
    // report to a diff that doesn't touch schema-failing entries must
    // NOT downgrade the exit code.
    const r = emptyReport({
      ok: false,
      schemaOk: false,
      totals: { entries: 1, schemaErrors: 1, missing: 0, stale: 0 },
      entries: [
        { index: 0, file: "src/a.tsx", reason: "x", errors: ["bad"], matchedSites: [] },
      ],
    });
    const s = buildSummary(r, REPORT_PATH, { changed: ["src/unrelated.tsx"] });
    expect(s.schemaOk).toBe(false);
    expect(exitCodeFor(s)).toBe(2);
  });
});
