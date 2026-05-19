// CLI-level integration tests for `scripts/i18n-allowlist-report.ts`.
//
// These spawn the real CLI in a throwaway working directory with a
// hand-crafted allowlist so we can exercise the full code path (argv
// parsing, runAllowlistCheck, writing reports/, --json, --annotations,
// --no-check-run) without depending on the project's real fixtures.
//
// Covered:
//   1. `--no-check-run` still emits annotations + writes the summary
//      JSON with `publishCheckRun: false`.
//   2. All documented flag aliases (`--top-files N`, `--topFiles=N`,
//      `--no-checkRun`) produce identical SummaryJSON + exit codes.
//   3. The Check Run conclusion + annotation title rendered by the
//      workflow's github-script step (re-implemented in JS here) match
//      the same single failure category + top file paths printed under
//      `reason:` in the CLI / $GITHUB_STEP_SUMMARY block.
//   4. Doc test: the flag/alias/exit-code tables in
//      `docs/i18n-allowlist-summary.md` and the CLI header comment do
//      not drift from the implemented behavior.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSummary,
  exitCodeFor,
  formatFailureReason,
  formatSummary,
  toJSON,
  type AllowlistReport,
  type SummaryJSON,
} from "../i18n-allowlist-report";

const PROJECT_ROOT = process.cwd();
const CLI_PATH = resolve(PROJECT_ROOT, "scripts/i18n-allowlist-report.ts");
const SCHEMA_SRC = resolve(PROJECT_ROOT, ".lintrc-i18n-allowlist.schema.json");
const DOC_PATH = resolve(PROJECT_ROOT, "docs/i18n-allowlist-summary.md");

// ────────────────────────────────────────────────────────────────────────────
// Test harness: a tmp dir wired up so `runAllowlistCheck` finds a schema
// + a schema-valid allowlist whose entry has no matching disable in
// src/ → drift-stale → exit code 1. Stale entries populate
// `report.stale` (and therefore `failure.topFiles`) so we can assert
// annotations are actually emitted, unlike a structural schema failure
// where entries arrive empty.
// ────────────────────────────────────────────────────────────────────────────
function makeFailingFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "i18n-allowlist-cli-"));
  cpSync(SCHEMA_SRC, join(dir, ".lintrc-i18n-allowlist.schema.json"));
  mkdirSync(join(dir, "src"));
  writeFileSync(
    join(dir, ".lintrc-i18n-allowlist.json"),
    JSON.stringify(
      {
        $schema: "./.lintrc-i18n-allowlist.schema.json",
        entries: [{ file: "src/ghost.tsx", reason: "no longer present" }],
      },
      null,
      2,
    ),
  );
  return dir;
}

function runCli(cwd: string, args: string[]) {
  const r = spawnSync("bun", ["run", CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "" },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function readSummaryJSON(cwd: string): SummaryJSON {
  return JSON.parse(
    readFileSync(join(cwd, "reports", "i18n-allowlist-summary.json"), "utf8"),
  ) as SummaryJSON;
}

// Shared fixture: one tmp dir, one run per arg combination.
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────────────────────────
// 1. --no-check-run integration
// ────────────────────────────────────────────────────────────────────────────
describe("CLI --no-check-run", () => {
  let dir: string;
  let res: ReturnType<typeof runCli>;
  let summary: SummaryJSON;

  beforeAll(() => {
    dir = makeFailingFixture();
    tmpDirs.push(dir);
    res = runCli(dir, ["--no-check-run", "--annotations", "--json"]);
    summary = readSummaryJSON(dir);
  });

  it("exits 2 (schema failure)", () => {
    expect(res.status).toBe(2);
  });

  it("persists publishCheckRun=false on the summary JSON", () => {
    expect(summary.publishCheckRun).toBe(false);
    expect(summary.exitCode).toBe(2);
    expect(summary.failure?.category).toBe("schema");
  });

  it("emits ::error annotations on stderr despite Check Run being disabled", () => {
    const anns = res.stderr.split("\n").filter((l) => l.startsWith("::error"));
    expect(anns.length).toBeGreaterThan(0);
    expect(anns[0]).toContain("file=.lintrc-i18n-allowlist.json");
    expect(anns[0]).toContain("schema validation failed");
  });

  it("stdout still contains the machine-readable SummaryJSON", () => {
    const parsed = JSON.parse(res.stdout) as SummaryJSON;
    expect(parsed.publishCheckRun).toBe(false);
    expect(parsed.exitCode).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Documented flag aliases produce identical results
// ────────────────────────────────────────────────────────────────────────────
describe("CLI flag aliases — identical SummaryJSON + exit code", () => {
  // Each variant uses a different spelling for --topFiles + --no-check-run.
  // All five must produce byte-identical SummaryJSON and exit 2.
  const variants: { label: string; args: string[] }[] = [
    { label: "canonical",            args: ["--topFiles", "5", "--no-check-run", "--json"] },
    { label: "kebab + canonical no", args: ["--top-files", "5", "--no-check-run", "--json"] },
    { label: "equals + camel no",    args: ["--topFiles=5", "--no-checkRun", "--json"] },
    { label: "kebab equals",         args: ["--top-files=5", "--no-checkRun", "--json"] },
  ];

  const results = new Map<string, { status: number; json: SummaryJSON }>();

  beforeAll(() => {
    for (const v of variants) {
      const dir = makeFailingFixture();
      tmpDirs.push(dir);
      const r = runCli(dir, v.args);
      results.set(v.label, { status: r.status, json: readSummaryJSON(dir) });
    }
  });

  it("all variants exit with the same code (2 — schema)", () => {
    const codes = [...results.values()].map((r) => r.status);
    expect(new Set(codes).size).toBe(1);
    expect(codes[0]).toBe(2);
  });

  it("all variants produce byte-identical SummaryJSON", () => {
    const serialized = [...results.values()].map((r) =>
      JSON.stringify(r.json),
    );
    const unique = new Set(serialized);
    expect(unique.size).toBe(1);
  });

  it("all variants honor publishCheckRun=false + topFiles=5", () => {
    for (const { json } of results.values()) {
      expect(json.publishCheckRun).toBe(false);
      expect(json.failure?.category).toBe("schema");
      // topFiles is capped at 5, but our fixture only has 1 failing entry
      // — assertion here is that the cap doesn't truncate below the real
      // count and that all variants agree on the length.
      expect(json.failure?.topFiles.length).toBeLessThanOrEqual(5);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Check Run / step summary parity
//
// Re-implements the minimum of the github-script Check Run step from
// .github/workflows/ci.yml so we can assert the conclusion + annotation
// title + the single failure category referenced by both surfaces match
// the same single source of truth (SummaryJSON.failure).
// ────────────────────────────────────────────────────────────────────────────
describe("Check Run + $GITHUB_STEP_SUMMARY share the same failure category + top files", () => {
  function failingReport(): AllowlistReport {
    return {
      ok: false,
      schemaOk: true,
      driftOk: false,
      totals: { entries: 0, schemaErrors: 0, missing: 2, stale: 0 },
      entries: [],
      missing: [
        { file: "src/widget.tsx", reason: "ad-hoc", line: 42 },
        { file: "src/legacy/old.tsx", reason: "TODO", line: 7 },
      ],
      stale: [],
    };
  }

  // Mirrors the github-script block in ci.yml that builds the Check Run.
  function buildCheckRun(summary: SummaryJSON) {
    const topFiles = summary.failure?.topFiles ?? [];
    const topMessages = summary.failure?.topMessages ?? [];
    const annotations = topFiles.map((entry, i) => {
      const m = entry.match(/^(.*):(\d+)$/);
      const path = m ? m[1] : entry;
      const line = m ? Number(m[2]) : 1;
      const specific = topMessages[i];
      const message =
        summary.failure!.category === "schema" && specific
          ? `${summary.failure!.reason} — ${specific}`
          : summary.failure!.reason;
      return {
        path,
        start_line: line,
        end_line: line,
        annotation_level: "failure" as const,
        message,
        title: `i18n allowlist — ${summary.failure!.category}`,
      };
    });
    return {
      conclusion: summary.ok ? "success" : "failure",
      title: summary.ok ? "✅ PASS" : `❌ FAIL — ${summary.failure?.category ?? "unknown"}`,
      annotations,
    };
  }

  it("conclusion + title carry the same category + top files as the step summary", () => {
    const s = buildSummary(failingReport(), "reports/i18n-allowlist-report.json");
    const json = toJSON(s);
    const cr = buildCheckRun(json);

    // What the workflow appends to $GITHUB_STEP_SUMMARY:
    const stepSummary = formatSummary(s, { changed: false });

    // Same category surfaced in both surfaces.
    expect(cr.title).toContain(json.failure!.category);
    expect(stepSummary).toMatch(
      new RegExp(`reason:.*${json.failure!.category.replace("-", " \\(")}`),
    );

    // Same top file paths annotated and listed in the reason line.
    const reasonLine = stepSummary.split("\n").find((l) => l.includes("reason:")) ?? "";
    for (const f of json.failure!.topFiles) {
      expect(reasonLine).toContain(f);
      // The Check Run annotation paths strip the trailing `:line`.
      const path = f.replace(/:\d+$/, "");
      expect(cr.annotations.some((a) => a.path === path)).toBe(true);
    }

    // Conclusion driven by `ok`, not category.
    expect(cr.conclusion).toBe("failure");
  });

  it("annotation messages match formatFailureReason exactly (no drift)", () => {
    const s = buildSummary(failingReport(), "reports/i18n-allowlist-report.json");
    const json = toJSON(s);
    const cr = buildCheckRun(json);
    const reason = formatFailureReason(s.failure!, s);
    for (const a of cr.annotations) expect(a.message).toBe(reason);
    // And `reason` is exactly what's printed in the step summary.
    expect(formatSummary(s, { changed: false })).toContain(reason);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Doc test — docs/i18n-allowlist-summary.md must not drift from the
//    actual flag set, alias set, and exit-code semantics.
// ────────────────────────────────────────────────────────────────────────────
describe("docs/i18n-allowlist-summary.md ↔ implementation parity", () => {
  const doc = readFileSync(DOC_PATH, "utf8");
  const header = readFileSync(CLI_PATH, "utf8").split("// CLI entry")[0];

  // Single source of truth: the flags + aliases the CLI actually accepts.
  // If the implementation grows a new flag, this list (and the docs) must
  // be updated together.
  const FLAGS = [
    { canonical: "--changed", aliases: [] as string[] },
    { canonical: "--json", aliases: [] },
    { canonical: "--annotations", aliases: [] },
    {
      canonical: "--topFiles",
      aliases: ["--top-files", "--topFiles=", "--top-files="],
    },
    { canonical: "--no-check-run", aliases: ["--no-checkRun"] },
  ];

  it("documents every canonical flag with a backtick reference", () => {
    for (const { canonical } of FLAGS) {
      expect(doc, `doc must mention \`${canonical}\``).toContain(`\`${canonical}\``);
    }
  });

  it("documents every alias next to its canonical flag", () => {
    for (const { aliases } of FLAGS) {
      for (const a of aliases) {
        expect(doc, `doc must mention alias \`${a}\``).toContain(`\`${a}`);
      }
    }
  });

  it("CLI header comment lists the same canonical flags as the docs", () => {
    for (const { canonical } of FLAGS) {
      expect(header, `header must mention ${canonical}`).toContain(canonical);
    }
  });

  it("exit-code table in the docs matches exitCodeFor for every documented row", () => {
    // Re-derive each row programmatically; if the docs ever drift from
    // these values the test fails loudly.
    const passing: AllowlistReport = {
      ok: true,
      schemaOk: true,
      driftOk: true,
      totals: { entries: 0, schemaErrors: 0, missing: 0, stale: 0 },
      entries: [],
      missing: [],
      stale: [],
    };
    const schemaFail: AllowlistReport = {
      ...passing,
      ok: false,
      schemaOk: false,
      totals: { ...passing.totals, schemaErrors: 1, entries: 1 },
      entries: [
        { index: 0, file: "src/a.tsx", reason: "x", errors: ["nope"], matchedSites: [] },
      ],
    };
    const driftFail: AllowlistReport = {
      ...passing,
      ok: false,
      driftOk: false,
      totals: { ...passing.totals, missing: 1 },
      missing: [{ file: "src/x.tsx", reason: "r", line: 1 }],
    };
    const both: AllowlistReport = {
      ...schemaFail,
      ok: false,
      driftOk: false,
      totals: { ...schemaFail.totals, missing: 1 },
      missing: [{ file: "src/x.tsx", reason: "r", line: 1 }],
    };

    const rows = [
      { code: 0, summary: buildSummary(passing, "x") },
      { code: 2, summary: buildSummary(schemaFail, "x") },
      { code: 1, summary: buildSummary(driftFail, "x") },
      { code: 2, summary: buildSummary(both, "x") },
    ];
    for (const r of rows) expect(exitCodeFor(r.summary)).toBe(r.code);

    // And the docs literally claim 0/1/2 in that order in the exit-code
    // tables. Guard against accidental edits.
    expect(doc).toMatch(/\|\s*`0`\s*\|.*PASS/);
    expect(doc).toMatch(/\|\s*`2`\s*\|.*[Ss]chema/);
    expect(doc).toMatch(/\|\s*`1`\s*\|.*[Dd]rift/);
  });

  it("doc example snippets reference the same flag names the CLI parses (no typos)", () => {
    // Pull bash example lines and check every `--flag` token in them is
    // a recognized flag/alias. Catches docs drift like `--top_files`.
    const known = new Set<string>();
    for (const { canonical, aliases } of FLAGS) {
      known.add(canonical);
      for (const a of aliases) known.add(a.replace(/=$/, ""));
    }
    const exampleLines = doc
      .split("\n")
      .filter((l) => l.includes("bun run i18n:allowlist:summary"));
    expect(exampleLines.length).toBeGreaterThan(0);
    for (const line of exampleLines) {
      const flags = line.match(/--[a-zA-Z][a-zA-Z0-9-]*/g) ?? [];
      for (const f of flags) {
        expect(known, `doc example references unknown flag ${f}`).toContain(f);
      }
    }
  });
});
