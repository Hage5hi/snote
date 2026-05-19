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
  it("schema failure surfaces the top entries[i] file paths", () => {
    const r = makeReport({
      entries: [
        { index: 0, file: "src/a.tsx", reason: "x", errors: ["bad"], matchedSites: [] },
        { index: 1, file: "src/b.tsx", reason: "y", errors: ["bad2"], matchedSites: [] },
      ],
      totals: { entries: 2, schemaErrors: 2, missing: 0, stale: 0 },
    });
    r.schemaOk = false;
    r.ok = false;
    const s = buildSummary(r, REPORT_PATH);
    expect(s.failure?.category).toBe("schema");
    expect(s.failure?.topFiles).toEqual(["src/a.tsx", "src/b.tsx"]);
    expect(formatFailureReason(s.failure!, s)).toMatch(/schema validation failed.*src\/a\.tsx, src\/b\.tsx/);
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
});
