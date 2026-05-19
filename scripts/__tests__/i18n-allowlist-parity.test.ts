// Parity test: the one-line failure category + top file paths must be
// identical across all three CI surfaces — the CLI stdout, the
// $GITHUB_STEP_SUMMARY block, and the sticky PR comment body. If any of
// them drifts from the others a reviewer sees a different actionable
// signal depending on where they look, which defeats the whole point of
// the concise summary.
import { describe, expect, it } from "vitest";
import {
  buildSummary,
  formatAnnotations,
  formatFailureReason,
  formatSummary,
  toJSON,
  type AllowlistReport,
} from "../i18n-allowlist-report";
import {
  build as buildPRComment,
  renderFailureSection,
  resolveCIContext,
} from "../i18n-allowlist-pr-comment";

const REPORT_PATH = "reports/i18n-allowlist-report.json";

function failingReport(): AllowlistReport {
  // A realistic failing report: drift-missing across two files. The
  // failure reason should call out drift-missing + both files.
  return {
    ok: false,
    schemaOk: true,
    driftOk: false,
    totals: { entries: 1, schemaErrors: 0, missing: 2, stale: 1 },
    entries: [
      {
        index: 0,
        file: "src/a.tsx",
        reason: "shrug",
        errors: [],
        matchedSites: [{ file: "src/a.tsx", line: 1 }],
      },
    ],
    missing: [
      { file: "src/widget.tsx", reason: "ad-hoc", line: 42 },
      { file: "src/legacy/old.tsx", reason: "TODO", line: 7 },
    ],
    stale: ["src/removed.tsx::nope"],
  };
}

describe("failure-line parity across CLI / step summary / PR comment", () => {
  const report = failingReport();
  const summary = buildSummary(report, REPORT_PATH);
  const ctx = resolveCIContext({
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_RUN_ID: "1",
  });

  const cliText = formatSummary(summary, { changed: false });
  const stepSummary = `### i18n allowlist summary\n\`\`\`\n${cliText}\n\`\`\`\n`;
  const prComment = buildPRComment(ctx, report);
  const json = toJSON(summary);
  const annotations = formatAnnotations(summary);
  const reasonLine = formatFailureReason(summary.failure!, summary);

  it("CLI, JSON, and PR comment all carry the same failure category", () => {
    expect(summary.failure?.category).toBe("drift-missing");
    expect(json.failure?.category).toBe("drift-missing");
    expect(cliText).toContain("drift (missing)");
    expect(prComment).toContain("`drift-missing`");
  });

  it("the same reason string appears in CLI, step summary, JSON, and PR comment", () => {
    expect(cliText).toContain(reasonLine);
    expect(stepSummary).toContain(reasonLine);
    expect(json.failure?.reason).toBe(reasonLine);
    expect(prComment).toContain(reasonLine);
  });

  it("top offending file paths appear in every surface (CLI, JSON, PR comment, annotations)", () => {
    const tops = summary.failure!.topFiles;
    expect(tops).toContain("src/widget.tsx:42");
    expect(tops).toContain("src/legacy/old.tsx:7");
    for (const t of tops) {
      expect(cliText).toContain(t);
      expect(prComment).toContain(t);
    }
    expect(json.failure?.topFiles).toEqual(tops);
    // Annotations carry the file path (and line, for drift-missing).
    expect(annotations).toEqual([
      expect.stringMatching(/^::error file=src\/widget\.tsx,line=42::/),
      expect.stringMatching(/^::error file=src\/legacy\/old\.tsx,line=7::/),
    ]);
    for (const a of annotations) expect(a).toContain("i18n allowlist —");
  });

  it("PR comment renders the dedicated failure section verbatim", () => {
    const section = renderFailureSection(summary).join("\n");
    expect(section).toContain("**Failure category:** `drift-missing`");
    expect(section).toContain(reasonLine);
    expect(section).toContain("`src/widget.tsx:42`");
    expect(prComment).toContain(section);
  });

  it("passing report → no failure section, no annotations, no `reason:` line", () => {
    const passing: AllowlistReport = {
      ok: true,
      schemaOk: true,
      driftOk: true,
      totals: { entries: 0, schemaErrors: 0, missing: 0, stale: 0 },
      entries: [],
      missing: [],
      stale: [],
    };
    const s = buildSummary(passing, REPORT_PATH);
    expect(formatAnnotations(s)).toEqual([]);
    expect(formatSummary(s, { changed: false })).not.toContain("reason:");
    expect(buildPRComment(ctx, passing)).not.toContain("Failure category");
  });
});

describe("--json output shape", () => {
  it("emits stable counts + failure object for failing reports", () => {
    const summary = buildSummary(failingReport(), REPORT_PATH);
    const j = toJSON(summary);
    expect(Object.keys(j).sort()).toEqual(
      [
        "ok",
        "schemaOk",
        "driftOk",
        "scopedToChanges",
        "reportPath",
        "counts",
        "fullCounts",
        "failure",
      ].sort(),
    );
    expect(j.counts).toEqual({ entries: 1, schemaErrors: 0, missing: 2, stale: 1 });
    expect(j.fullCounts).toEqual(j.counts);
    expect(j.failure).toMatchObject({
      category: "drift-missing",
      topFiles: ["src/widget.tsx:42", "src/legacy/old.tsx:7"],
    });
  });

  it("counts and fullCounts diverge under --changed scoping", () => {
    const summary = buildSummary(failingReport(), REPORT_PATH, {
      changed: ["src/widget.tsx"], // only one of the two missing files
    });
    const j = toJSON(summary);
    expect(j.scopedToChanges).toBe(true);
    expect(j.counts.missing).toBe(1);
    expect(j.fullCounts.missing).toBe(2);
  });
});

describe("formatSummary side-by-side scoped/full counts", () => {
  it("renders `scoped / full` when --changed is honored", () => {
    const summary = buildSummary(failingReport(), REPORT_PATH, {
      changed: ["src/widget.tsx"],
    });
    const text = formatSummary(summary, { changed: true });
    expect(text).toContain("missing:    1 (scoped) / 2 (full repo)");
    expect(text).toContain("stale:      0 (scoped) / 1 (full repo)");
  });

  it("renders only one number when scoping falls back to FULL", () => {
    const summary = buildSummary(failingReport(), REPORT_PATH, {
      changed: ["README.md"], // none i18n-relevant → falls back
    });
    const text = formatSummary(summary, { changed: true });
    expect(text).not.toContain("(scoped)");
    expect(text).toContain("missing:    2  (unallowlisted disables)");
  });
});
