// Unit tests for the --changed scoping + failure-reason logic in
// scripts/i18n-allowlist-report.ts. These exercise the pure helpers so we
// can simulate any combination of git output / report content without
// shelling out or mutating the working tree.
import { describe, expect, it } from "vitest";
import {
  buildSummary,
  buildFailureReason,
  formatFailureReason,
  getChangedFiles,
  isI18nRelevant,
  type AllowlistReport,
} from "../i18n-allowlist-report";

const REPORT_PATH = "reports/i18n-allowlist-report.json";

function makeReport(overrides: Partial<AllowlistReport> = {}): AllowlistReport {
  const base: AllowlistReport = {
    ok: true,
    schemaOk: true,
    driftOk: true,
    totals: { entries: 0, schemaErrors: 0, missing: 0, stale: 0 },
    entries: [],
    missing: [],
    stale: [],
  };
  const merged = { ...base, ...overrides };
  merged.totals = {
    entries: merged.entries.length,
    schemaErrors:
      overrides.totals?.schemaErrors ??
      merged.entries.reduce((n, e) => n + e.errors.length, 0),
    missing: merged.missing.length,
    stale: merged.stale.length,
  };
  merged.schemaOk = merged.totals.schemaErrors === 0;
  merged.driftOk = merged.missing.length === 0 && merged.stale.length === 0;
  merged.ok = merged.schemaOk && merged.driftOk;
  return merged;
}

describe("isI18nRelevant", () => {
  it.each([
    ["locales/en.json", true],
    ["i18n/fr/common.json", true],
    ["src/i18n/index.ts", true],
    ["src/components/Foo.tsx", true],
    [".lintrc-i18n-allowlist.json", true],
    [".lintrc-i18n-allowlist.schema.json", true],
    ["README.md", false],
    ["docs/foo.md", false],
    ["scripts/build.ts", false],
    ["package.json", false],
  ])("classifies %s → %s", (path, expected) => {
    expect(isI18nRelevant(path)).toBe(expected);
  });
});

describe("getChangedFiles", () => {
  it("combines `git diff` (tracked) with `git ls-files --others` (untracked) and de-dupes", () => {
    const runner = (cmd: string) => {
      if (cmd === "git diff --name-only HEAD") return "src/a.tsx\nsrc/b.tsx\n";
      if (cmd === "git ls-files --others --exclude-standard")
        return "locales/de.json\nsrc/b.tsx\n"; // duplicate `src/b.tsx`
      throw new Error(`unexpected cmd ${cmd}`);
    };
    expect(getChangedFiles(runner)).toEqual([
      "src/a.tsx",
      "src/b.tsx",
      "locales/de.json",
    ]);
  });

  it("returns tracked changes when ls-files fails (non-fatal)", () => {
    const runner = (cmd: string) => {
      if (cmd === "git diff --name-only HEAD") return "src/a.tsx\n";
      throw new Error("ls-files boom");
    };
    expect(getChangedFiles(runner)).toEqual(["src/a.tsx"]);
  });

  it("returns null when git itself is unavailable", () => {
    const runner = () => {
      throw new Error("not a git repo");
    };
    expect(getChangedFiles(runner)).toBeNull();
  });
});

describe("buildSummary — full report (no --changed)", () => {
  it("mirrors the report when no scoping requested", () => {
    const r = makeReport({
      entries: [
        { index: 0, file: "src/a.tsx", reason: "x", errors: [], matchedSites: [] },
      ],
    });
    const s = buildSummary(r, REPORT_PATH);
    expect(s.ok).toBe(true);
    expect(s.scopeNote).toBe("");
    expect(s.scopedToChanges).toBe(false);
    expect(s.totals.entries).toBe(1);
    expect(s.failure).toBeUndefined();
  });
});

describe("buildSummary — --changed scoping", () => {
  const report = makeReport({
    entries: [
      { index: 0, file: "src/a.tsx", reason: "x", errors: [], matchedSites: [{ file: "src/a.tsx", line: 1 }] },
      { index: 1, file: "src/b.tsx", reason: "y", errors: [], matchedSites: [{ file: "src/b.tsx", line: 2 }] },
    ],
    missing: [
      { file: "src/a.tsx", reason: "z", line: 10 },
      { file: "src/c.tsx", reason: "z", line: 20 },
    ],
    stale: ["src/b.tsx::y", "src/d.tsx::w"],
  });

  it("scopes missing/stale/entries to changed files only", () => {
    const s = buildSummary(report, REPORT_PATH, {
      changed: ["src/a.tsx", "src/b.tsx"],
    });
    expect(s.scopedToChanges).toBe(true);
    expect(s.totals.entries).toBe(2); // both a + b touched
    expect(s.missingCount).toBe(1); // only src/a.tsx
    expect(s.staleCount).toBe(1); // only src/b.tsx
    expect(s.ok).toBe(false);
    expect(s.scopeNote).toContain("--changed");
    expect(s.scopeNote).not.toContain("FULL report");
  });

  it("falls back to FULL when no i18n-relevant files changed", () => {
    const s = buildSummary(report, REPORT_PATH, {
      changed: ["README.md", "docs/foo.md"],
    });
    expect(s.scopedToChanges).toBe(false);
    expect(s.scopeNote).toContain("none i18n-relevant");
    expect(s.scopeNote).toContain("FULL report");
    // Falls back → full counts.
    expect(s.missingCount).toBe(2);
    expect(s.staleCount).toBe(2);
  });

  it("falls back to FULL when git diff fails (changed = null)", () => {
    const s = buildSummary(report, REPORT_PATH, { changed: null });
    expect(s.scopedToChanges).toBe(false);
    expect(s.scopeNote).toContain("git diff` failed");
    expect(s.scopeNote).toContain("FULL report");
    expect(s.missingCount).toBe(2);
    expect(s.staleCount).toBe(2);
  });

  it("treats allowlist config touch as i18n-relevant even if no source changed", () => {
    const s = buildSummary(report, REPORT_PATH, {
      changed: [".lintrc-i18n-allowlist.json"],
    });
    expect(s.scopedToChanges).toBe(true);
    // No drift entries match the config file → scoped counts are 0,
    // verdict flips to PASS even though full report is failing.
    expect(s.missingCount).toBe(0);
    expect(s.staleCount).toBe(0);
    expect(s.ok).toBe(true);
  });
});

describe("buildFailureReason", () => {
  it("schema failure points at the allowlist config (with line) per failing entry", () => {
    const r = makeReport({
      entries: [
        { index: 0, file: "src/a.tsx", reason: "x", errors: ["bad"], matchedSites: [] },
        { index: 1, file: "src/b.tsx", reason: "y", errors: ["bad2"], matchedSites: [] },
      ],
      totals: { entries: 2, schemaErrors: 2, missing: 0, stale: 0 },
    });
    r.schemaOk = false;
    r.ok = false;
    // Stub line lookup: index 0 → line 10, index 1 → line 25.
    const s = buildSummary(r, REPORT_PATH, {
      entryLineLookup: (i) => (i === 0 ? 10 : 25),
    });
    expect(s.failure?.category).toBe("schema");
    expect(s.failure?.topFiles).toEqual([
      ".lintrc-i18n-allowlist.json:10",
      ".lintrc-i18n-allowlist.json:25",
    ]);
    expect(formatFailureReason(s.failure!, s)).toMatch(
      /schema validation failed.*\.lintrc-i18n-allowlist\.json:10, \.lintrc-i18n-allowlist\.json:25/,
    );
  });

  it("schema failure falls back to file-only when no line lookup is provided", () => {
    const r = makeReport({
      entries: [
        { index: 0, file: "src/a.tsx", reason: "x", errors: ["bad"], matchedSites: [] },
      ],
      totals: { entries: 1, schemaErrors: 1, missing: 0, stale: 0 },
    });
    r.schemaOk = false;
    r.ok = false;
    const s = buildSummary(r, REPORT_PATH);
    expect(s.failure?.topFiles).toEqual([".lintrc-i18n-allowlist.json"]);
  });

  it("missing drift takes priority over stale and lists file:line", () => {
    const r = makeReport({
      missing: [
        { file: "src/a.tsx", reason: "r", line: 12 },
        { file: "src/b.tsx", reason: "r", line: 9 },
      ],
      stale: ["src/x.tsx::r"],
    });
    const f = buildFailureReason(
      { schemaOk: true, missingCount: 2, staleCount: 1, totals: r.totals },
      r,
    );
    expect(f.category).toBe("drift-missing");
    expect(f.topFiles).toEqual(["src/a.tsx:12", "src/b.tsx:9"]);
  });

  it("stale drift surfaces deduped file paths", () => {
    const r = makeReport({
      stale: ["src/a.tsx::r1", "src/a.tsx::r2", "src/b.tsx::r3"],
    });
    const f = buildFailureReason(
      { schemaOk: true, missingCount: 0, staleCount: 3, totals: r.totals },
      r,
    );
    expect(f.category).toBe("drift-stale");
    expect(f.topFiles).toEqual(["src/a.tsx", "src/b.tsx"]);
  });

  it("honors topN to clamp/expand surfaced top files", () => {
    const r = makeReport({
      missing: Array.from({ length: 5 }, (_, i) => ({
        file: `src/f${i}.tsx`,
        reason: "r",
        line: i,
      })),
    });
    const f1 = buildFailureReason(
      { schemaOk: true, missingCount: 5, staleCount: 0, totals: r.totals },
      r,
      { topN: 1 },
    );
    expect(f1.topFiles).toEqual(["src/f0.tsx:0"]);
    const f5 = buildFailureReason(
      { schemaOk: true, missingCount: 5, staleCount: 0, totals: r.totals },
      r,
      { topN: 5 },
    );
    expect(f5.topFiles).toHaveLength(5);
  });
});

describe("findAllowlistEntryLines", () => {
  it("returns 1-based start line of each top-level entry object", async () => {
    const { findAllowlistEntryLines } = await import("../i18n-allowlist-report");
    const src = [
      "{",
      '  "version": 1,',
      '  "entries": [',
      "    {",
      '      "file": "src/a.tsx",',
      '      "reason": "x"',
      "    },",
      "    {",
      '      "file": "src/b.tsx",',
      '      "reason": "y"',
      "    }",
      "  ]",
      "}",
    ].join("\n");
    expect(findAllowlistEntryLines(src)).toEqual([4, 8]);
  });

  it("returns [] when the entries array can't be located", async () => {
    const { findAllowlistEntryLines } = await import("../i18n-allowlist-report");
    expect(findAllowlistEntryLines("{}")).toEqual([]);
  });
});

describe("parseTopFilesArg", () => {
  it.each<[string[], number]>([
    [["--topFiles", "5"], 5],
    [["--topFiles=7"], 7],
    [["--top-files", "2"], 2],
    [["--top-files=4"], 4],
    [["--changed"], 3],
    [["--topFiles", "0"], 3],
    [["--topFiles", "abc"], 3],
  ])("parses %j → %i", async (argv, expected) => {
    const { parseTopFilesArg } = await import("../i18n-allowlist-report");
    expect(parseTopFilesArg(argv)).toBe(expected);
  });
});
