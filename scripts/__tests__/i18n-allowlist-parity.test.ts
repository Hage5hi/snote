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
        "exitCode",
        "publishCheckRun",
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

// ────────────────────────────────────────────────────────────────────────────
// New surface contracts: exit codes, --no-check-run flag, schema messages,
// PR comment summary-artifact link. Pinned here so any regression in the
// shared report helpers fails fast.
// ────────────────────────────────────────────────────────────────────────────
import { exitCodeFor } from "../i18n-allowlist-report";

function schemaFailingReport(): AllowlistReport {
  return {
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
        errors: ["unknown key `whoops`"],
        matchedSites: [],
      },
    ],
    missing: [],
    stale: [],
  };
}

describe("exit codes distinguish schema vs drift", () => {
  it("pass → 0", () => {
    const s = buildSummary(
      {
        ok: true,
        schemaOk: true,
        driftOk: true,
        totals: { entries: 0, schemaErrors: 0, missing: 0, stale: 0 },
        entries: [],
        missing: [],
        stale: [],
      },
      REPORT_PATH,
    );
    expect(exitCodeFor(s)).toBe(0);
    expect(toJSON(s).exitCode).toBe(0);
  });

  it("schema failure → 2 (even when drift would also fail)", () => {
    const r = schemaFailingReport();
    r.driftOk = false;
    r.missing = [{ file: "src/x.tsx", reason: "r", line: 1 }];
    r.totals.missing = 1;
    const s = buildSummary(r, REPORT_PATH);
    expect(exitCodeFor(s)).toBe(2);
    expect(toJSON(s).exitCode).toBe(2);
  });

  it("drift-only failure → 1", () => {
    const s = buildSummary(failingReport(), REPORT_PATH);
    expect(exitCodeFor(s)).toBe(1);
    expect(toJSON(s).exitCode).toBe(1);
  });
});

describe("--no-check-run flag", () => {
  it("toJSON defaults publishCheckRun=true", () => {
    expect(toJSON(buildSummary(failingReport(), REPORT_PATH)).publishCheckRun).toBe(true);
  });
  it("propagates publishCheckRun=false when requested", () => {
    const j = toJSON(buildSummary(failingReport(), REPORT_PATH), {
      publishCheckRun: false,
    });
    expect(j.publishCheckRun).toBe(false);
  });
});

describe("schema annotations carry per-line error messages", () => {
  it("formatAnnotations appends the entry-specific schema error", () => {
    const s = buildSummary(schemaFailingReport(), REPORT_PATH, {
      entryLineLookup: (i) => (i === 0 ? 10 : 25),
    });
    const anns = formatAnnotations(s);
    expect(anns).toHaveLength(2);
    expect(anns[0]).toContain("file=.lintrc-i18n-allowlist.json,line=10");
    expect(anns[0]).toContain("must contain property `reason`");
    expect(anns[1]).toContain("line=25");
    expect(anns[1]).toContain("unknown key `whoops`");
  });

  it("toJSON.failure.topMessages aligns with topFiles for schema", () => {
    const s = buildSummary(schemaFailingReport(), REPORT_PATH, {
      entryLineLookup: (i) => (i === 0 ? 10 : 25),
    });
    const j = toJSON(s);
    expect(j.failure?.topFiles).toEqual([
      ".lintrc-i18n-allowlist.json:10",
      ".lintrc-i18n-allowlist.json:25",
    ]);
    expect(j.failure?.topMessages).toEqual([
      "must contain property `reason`",
      "unknown key `whoops`",
    ]);
  });

  it("drift failures still emit topMessages array (null per entry)", () => {
    const j = toJSON(buildSummary(failingReport(), REPORT_PATH));
    expect(j.failure?.topMessages.every((m) => m === null)).toBe(true);
    expect(j.failure?.topMessages.length).toBe(j.failure?.topFiles.length);
  });
});

describe("PR comment links both artifact bundle AND summary JSON", () => {
  it("renders distinct links for full bundle and summary JSON when ids provided", () => {
    const ctx = resolveCIContext({
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "acme/widgets",
      GITHUB_RUN_ID: "999",
      I18N_ARTIFACT_ID: "111",
      I18N_SUMMARY_ARTIFACT_ID: "222",
    } as NodeJS.ProcessEnv);
    const body = buildPRComment(ctx, failingReport());
    expect(body).toContain(
      "https://github.com/acme/widgets/actions/runs/999/artifacts/111",
    );
    expect(body).toContain(
      "https://github.com/acme/widgets/actions/runs/999/artifacts/222",
    );
    expect(body).toContain("i18n-allowlist-summary.json");
  });

  it("falls back to run-level artifacts URL when summary id is missing", () => {
    const ctx = resolveCIContext({
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "acme/widgets",
      GITHUB_RUN_ID: "999",
      I18N_ARTIFACT_ID: "111",
    } as NodeJS.ProcessEnv);
    const body = buildPRComment(ctx, failingReport());
    expect(body).toContain("i18n-allowlist-summary.json");
    // Summary link degrades to the #artifacts anchor, not a stale id.
    expect(body).toMatch(/Download concise summary JSON.*runs\/999#artifacts\)/);
  });
});
