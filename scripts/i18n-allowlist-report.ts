// Local CLI: run the i18n allowlist check (silently) and print a concise
// summary read straight from reports/i18n-allowlist-report.json.
//
// Usage:
//   bun run i18n:allowlist:summary
//   bun run i18n:allowlist:summary --changed
//
// Flags:
//   --changed    Only print results scoped to files changed in the working
//                tree. Combines `git diff --name-only HEAD` (staged +
//                unstaged tracked changes) with `git ls-files --others
//                --exclude-standard` so brand-new untracked locale / i18n
//                files (which are exactly the ones a contributor is about
//                to add) are also picked up. Falls back to the full report
//                when git is unavailable or no i18n-relevant file changed.
//
// Output always includes:
//   • the absolute / relative path to reports/i18n-allowlist-report.json
//   • the four counters (schemaOk, driftOk, missing, stale)
//   • on failure: a single one-line reason that names the failing category
//     (schema / drift-missing / drift-stale) and the top file path(s)
//
// This file exposes pure helpers (`getChangedFiles`, `buildSummary`,
// `formatSummary`, `buildFailureReason`) so the scoping + failure-reason
// logic can be unit tested in isolation — see
// scripts/__tests__/i18n-allowlist-summary.test.ts. The CLI side effects
// (running the real allowlist check, writing to stdout, exiting) only fire
// when the file is executed directly.
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";
import { runAllowlistCheck } from "./i18n-allowlist-check";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────
export interface EntryReport {
  index: number;
  file: string;
  reason: string;
  errors: string[];
  matchedSites: { file: string; line: number }[];
}
export interface MissingRow {
  file: string;
  reason: string;
  line: number;
}
export interface AllowlistReport {
  ok: boolean;
  schemaOk: boolean;
  driftOk: boolean;
  totals: { entries: number; schemaErrors: number; missing: number; stale: number };
  entries: EntryReport[];
  missing: MissingRow[];
  stale: string[];
}

export type FailureCategory = "schema" | "drift-missing" | "drift-stale" | "unknown";

export interface Summary {
  /** Whether the (possibly scoped) verdict passes. */
  ok: boolean;
  schemaOk: boolean;
  driftOk: boolean;
  totals: AllowlistReport["totals"];
  missingCount: number;
  staleCount: number;
  /** Path to the JSON the summary was derived from (relative to cwd). */
  reportPath: string;
  /**
   * Human-readable note explaining the scope of the summary — populated
   * only when --changed was requested. Empty when summary is full-repo.
   */
  scopeNote: string;
  /** Whether --changed was honored (vs falling back to a full report). */
  scopedToChanges: boolean;
  /** Per-category failure breakdown, used by buildFailureReason. */
  failure?: {
    category: FailureCategory;
    /** Up to ~3 file paths most likely to need attention. */
    topFiles: string[];
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers (tested in scripts/__tests__/i18n-allowlist-summary.test.ts)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Files changed in the working tree.
 *   • staged + unstaged tracked changes  → `git diff --name-only HEAD`
 *   • brand-new untracked files          → `git ls-files --others --exclude-standard`
 *
 * Returns `null` when git is unavailable (CI checkout corrupted, no .git
 * dir, etc.) so callers can fall back to a full report cleanly.
 *
 * The `runner` argument is injectable so tests can simulate git failure /
 * specific output without touching the real shell.
 */
export function getChangedFiles(
  runner: (cmd: string) => string = (cmd) => execSync(cmd, { encoding: "utf8" }),
): string[] | null {
  const collect = (cmd: string): string[] => {
    const out = runner(cmd);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  };
  try {
    const tracked = collect("git diff --name-only HEAD");
    let untracked: string[] = [];
    try {
      untracked = collect("git ls-files --others --exclude-standard");
    } catch {
      // `ls-files` failing on its own is non-fatal — keep tracked changes.
    }
    // De-dupe while preserving order.
    return Array.from(new Set([...tracked, ...untracked]));
  } catch {
    return null;
  }
}

/** Regex used to decide whether a changed path is i18n-relevant. */
const I18N_PATH_RE =
  /^(locales|i18n|src\/i18n)\/.+\.(json|tsx?|jsx?)$|^src\/.+\.(t|j)sx?$/;
const ALLOWLIST_CONFIG = ".lintrc-i18n-allowlist.json";
const ALLOWLIST_SCHEMA = ".lintrc-i18n-allowlist.schema.json";

/** True when the given path matters for allowlist drift. */
export function isI18nRelevant(path: string): boolean {
  return (
    path === ALLOWLIST_CONFIG ||
    path === ALLOWLIST_SCHEMA ||
    I18N_PATH_RE.test(path)
  );
}

/**
 * Build a summary view over the report.
 *
 * @param report      The parsed JSON written by the allowlist check.
 * @param reportPath  Display path included in the summary output.
 * @param opts.changed When provided, treats the array as the list of files
 *                     changed in the working tree and scopes drift counts
 *                     to those files. When the array contains no
 *                     i18n-relevant entries, the summary falls back to the
 *                     full report and `scopeNote` explains why. When
 *                     `changed` is `null`, --changed was requested but git
 *                     was unavailable — also falls back, with a different
 *                     note. When undefined, no scoping is applied.
 */
export function buildSummary(
  report: AllowlistReport,
  reportPath: string,
  opts: { changed?: string[] | null } = {},
): Summary {
  const base: Summary = {
    ok: report.ok,
    schemaOk: report.schemaOk,
    driftOk: report.driftOk,
    totals: report.totals,
    missingCount: report.totals.missing,
    staleCount: report.totals.stale,
    reportPath,
    scopeNote: "",
    scopedToChanges: false,
  };

  if (opts.changed === undefined) {
    return withFailure(base, report);
  }

  if (opts.changed === null) {
    return withFailure(
      {
        ...base,
        scopeNote:
          "  scope:      --changed requested, but `git diff` failed — falling back to FULL report",
      },
      report,
    );
  }

  const changed = opts.changed.map((f) => f.replaceAll("\\", "/"));
  const changedSet = new Set(changed);
  const relevantChanged = changed.filter(isI18nRelevant);
  const isRelevant = (f: string) => changedSet.has(f);

  if (relevantChanged.length === 0) {
    return withFailure(
      {
        ...base,
        scopeNote: `  scope:      --changed (${changed.length} file(s) changed, none i18n-relevant) — falling back to FULL report`,
      },
      report,
    );
  }

  const scopedMissing = report.missing.filter((m) => isRelevant(m.file));
  const scopedStale = report.stale.filter((k) => isRelevant(k.split("::")[0]));
  const scopedEntries = report.entries.filter(
    (e) => isRelevant(e.file) || e.matchedSites.some((s) => isRelevant(s.file)),
  );

  // Schema is repo-wide and must always be valid; drift is scoped.
  const scopedSchemaOk = report.schemaOk;
  const scopedDriftOk = scopedMissing.length === 0 && scopedStale.length === 0;
  const scopedOk = scopedSchemaOk && scopedDriftOk;

  const scoped: AllowlistReport = {
    ...report,
    ok: scopedOk,
    schemaOk: scopedSchemaOk,
    driftOk: scopedDriftOk,
    totals: {
      entries: scopedEntries.length,
      schemaErrors: report.totals.schemaErrors,
      missing: scopedMissing.length,
      stale: scopedStale.length,
    },
    entries: scopedEntries,
    missing: scopedMissing,
    stale: scopedStale,
  };

  return withFailure(
    {
      ok: scopedOk,
      schemaOk: scopedSchemaOk,
      driftOk: scopedDriftOk,
      totals: scoped.totals,
      missingCount: scopedMissing.length,
      staleCount: scopedStale.length,
      reportPath,
      scopeNote: `  scope:      --changed (${scopedEntries.length} entry/entries + ${scopedMissing.length} missing + ${scopedStale.length} stale relevant to your diff)`,
      scopedToChanges: true,
    },
    scoped,
  );
}

function withFailure(summary: Summary, report: AllowlistReport): Summary {
  if (summary.ok) return summary;
  return { ...summary, failure: buildFailureReason(summary, report) };
}

/**
 * Decide which category most clearly explains the non-zero exit and
 * surface the top offending file paths so a developer can jump straight
 * to the fix. Order is intentional: schema first (config is invalid →
 * nothing else can be trusted), then drift-missing (new disables that
 * need allowlisting), then drift-stale (allowlist entries to remove).
 */
export function buildFailureReason(
  summary: Pick<Summary, "schemaOk" | "missingCount" | "staleCount" | "totals">,
  report: AllowlistReport,
): { category: FailureCategory; topFiles: string[] } {
  if (!summary.schemaOk) {
    const topFiles = report.entries
      .filter((e) => e.errors.length > 0)
      .slice(0, 3)
      .map((e) => e.file);
    return { category: "schema", topFiles };
  }
  if (summary.missingCount > 0) {
    const topFiles = uniq(report.missing.map((m) => `${m.file}:${m.line}`)).slice(0, 3);
    return { category: "drift-missing", topFiles };
  }
  if (summary.staleCount > 0) {
    const topFiles = uniq(report.stale.map((s) => s.split("::")[0])).slice(0, 3);
    return { category: "drift-stale", topFiles };
  }
  return { category: "unknown", topFiles: [] };
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/** Build the one-line reason string shown after the counters on failure. */
export function formatFailureReason(failure: NonNullable<Summary["failure"]>, summary: Summary): string {
  const filesSuffix = failure.topFiles.length
    ? `  →  ${failure.topFiles.join(", ")}${failure.topFiles.length === 3 ? ", …" : ""}`
    : "";
  switch (failure.category) {
    case "schema":
      return `schema validation failed — ${summary.totals.schemaErrors} error${summary.totals.schemaErrors === 1 ? "" : "s"} in .lintrc-i18n-allowlist.json${filesSuffix}`;
    case "drift-missing":
      return `drift (missing) — ${summary.missingCount} unallowlisted no-restricted-syntax disable${summary.missingCount === 1 ? "" : "s"} in source${filesSuffix}`;
    case "drift-stale":
      return `drift (stale) — ${summary.staleCount} allowlist entr${summary.staleCount === 1 ? "y has" : "ies have"} no matching disable${filesSuffix}`;
    default:
      return "allowlist check reported failure (see report for details)";
  }
}

/** Format the full multi-line summary block (no trailing newline). */
export function formatSummary(summary: Summary, opts: { changed: boolean }): string {
  const tick = (b: boolean) => (b ? "✅" : "❌");
  const lines: string[] = [];
  lines.push("");
  lines.push(`i18n allowlist report  ${tick(summary.ok)} ${summary.ok ? "PASS" : "FAIL"}`);
  lines.push(`  path:       ${summary.reportPath}`);
  if (summary.scopeNote) lines.push(summary.scopeNote);
  lines.push(
    `  schemaOk:   ${tick(summary.schemaOk)} (${summary.totals.schemaErrors} error${summary.totals.schemaErrors === 1 ? "" : "s"})`,
  );
  lines.push(`  driftOk:    ${tick(summary.driftOk)}`);
  lines.push(
    `  entries:    ${summary.totals.entries}${opts.changed && summary.scopedToChanges ? " (scoped)" : ""}`,
  );
  lines.push(`  missing:    ${summary.missingCount}  (unallowlisted disables)`);
  lines.push(`  stale:      ${summary.staleCount}  (entries with no source match)`);
  if (!summary.ok && summary.failure) {
    lines.push(`  reason:     ${formatFailureReason(summary.failure, summary)}`);
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// CLI entry — only runs when this file is the process entry point so the
// helpers above can be imported by tests without side effects.
// ────────────────────────────────────────────────────────────────────────────
function isMain(): boolean {
  // `import.meta.url` resolves to the actual script even under bun/tsx.
  try {
    const here = fileURLToPath(import.meta.url);
    const entry = process.argv[1] ? resolve(process.argv[1]) : "";
    return entry === here;
  } catch {
    return false;
  }
}

if (isMain()) {
  const ROOT = process.cwd();
  const REPORT_PATH = join(ROOT, "reports", "i18n-allowlist-report.json");
  const CHANGED = process.argv.includes("--changed");

  runAllowlistCheck({ silent: true });

  const reportRel = relative(ROOT, REPORT_PATH) || REPORT_PATH;

  if (!existsSync(REPORT_PATH)) {
    console.log("");
    console.log("i18n allowlist report  ❌ FAIL");
    console.log(`  path:       ${reportRel}`);
    console.log(
      "  reason:     report file was not written (allowlist script crashed before emitting JSON)",
    );
    console.log("");
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as AllowlistReport;
  const summary = buildSummary(report, reportRel, {
    changed: CHANGED ? getChangedFiles() : undefined,
  });

  console.log(formatSummary(summary, { changed: CHANGED }));
  console.log("");
  if (!summary.ok) process.exit(1);
}
