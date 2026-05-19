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
  /** Full-repo totals — equals `totals` when no scoping was applied. */
  fullTotals: AllowlistReport["totals"];
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
export interface BuildSummaryOpts {
  changed?: string[] | null;
  /** Max top-files surfaced. Default 3. Clamped to ≥1. */
  topN?: number;
  /**
   * Optional resolver mapping an entry's index → line in
   * `.lintrc-i18n-allowlist.json`. Used so schema failures surface as
   * `.lintrc-i18n-allowlist.json:42` instead of pointing at entry.file.
   */
  entryLineLookup?: (entryIndex: number) => number | undefined;
}

export function buildSummary(
  report: AllowlistReport,
  reportPath: string,
  opts: BuildSummaryOpts = {},
): Summary {
  const topN = Math.max(1, opts.topN ?? DEFAULT_TOP_N);
  const failureOpts: FailureOpts = { topN, entryLineLookup: opts.entryLineLookup };

  const base: Summary = {
    ok: report.ok,
    schemaOk: report.schemaOk,
    driftOk: report.driftOk,
    totals: report.totals,
    fullTotals: report.totals,
    missingCount: report.totals.missing,
    staleCount: report.totals.stale,
    reportPath,
    scopeNote: "",
    scopedToChanges: false,
  };

  if (opts.changed === undefined) {
    return withFailure(base, report, failureOpts);
  }

  if (opts.changed === null) {
    return withFailure(
      {
        ...base,
        scopeNote:
          "  scope:      --changed requested, but `git diff` failed — falling back to FULL report",
      },
      report,
      failureOpts,
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
      failureOpts,
    );
  }

  const scopedMissing = report.missing.filter((m) => isRelevant(m.file));
  const scopedStale = report.stale.filter((k) => isRelevant(k.split("::")[0]));
  const scopedEntries = report.entries.filter(
    (e) => isRelevant(e.file) || e.matchedSites.some((s) => isRelevant(s.file)),
  );

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
      fullTotals: report.totals,
      missingCount: scopedMissing.length,
      staleCount: scopedStale.length,
      reportPath,
      scopeNote: `  scope:      --changed (${scopedEntries.length} entry/entries + ${scopedMissing.length} missing + ${scopedStale.length} stale relevant to your diff)`,
      scopedToChanges: true,
    },
    scoped,
    failureOpts,
  );
}

/** Default cap on top offending paths surfaced in the failure reason. */
export const DEFAULT_TOP_N = 3;

interface FailureOpts {
  topN: number;
  entryLineLookup?: (entryIndex: number) => number | undefined;
}

function withFailure(
  summary: Summary,
  report: AllowlistReport,
  opts: FailureOpts,
): Summary {
  if (summary.ok) return summary;
  return { ...summary, failure: buildFailureReason(summary, report, opts) };
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
  opts: { topN?: number; entryLineLookup?: (i: number) => number | undefined } = {},
): { category: FailureCategory; topFiles: string[] } {
  const topN = Math.max(1, opts.topN ?? DEFAULT_TOP_N);
  const lookup = opts.entryLineLookup;

  if (!summary.schemaOk) {
    // Schema errors live in the allowlist JSON itself — point reviewers at
    // .lintrc-i18n-allowlist.json with the entry's start line (when we can
    // resolve it) instead of at entry.file, which is just the path the
    // broken entry was trying to reference.
    const topFiles = report.entries
      .filter((e) => e.errors.length > 0)
      .slice(0, topN)
      .map((e) => {
        const line = lookup?.(e.index);
        return line !== undefined
          ? `${ALLOWLIST_CONFIG}:${line}`
          : ALLOWLIST_CONFIG;
      });
    return { category: "schema", topFiles: uniq(topFiles) };
  }
  if (summary.missingCount > 0) {
    const topFiles = uniq(report.missing.map((m) => `${m.file}:${m.line}`)).slice(0, topN);
    return { category: "drift-missing", topFiles };
  }
  if (summary.staleCount > 0) {
    const topFiles = uniq(report.stale.map((s) => s.split("::")[0])).slice(0, topN);
    return { category: "drift-stale", topFiles };
  }
  return { category: "unknown", topFiles: [] };
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/**
 * Best-effort: given the raw text of `.lintrc-i18n-allowlist.json`,
 * return the 1-based start line of each top-level object inside the
 * `entries` array, in order. Used by `buildFailureReason` to attach line
 * numbers to schema-error annotations.
 *
 * We scan character-by-character tracking brace/bracket depth so we don't
 * need a JSON CST dependency. Returns `[]` when the array can't be
 * located (e.g. malformed JSON the schema check is about to flag anyway).
 */
export function findAllowlistEntryLines(src: string): number[] {
  const m = src.match(/"entries"\s*:\s*\[/);
  if (!m) return [];
  let pos = m.index! + m[0].length;
  let depth = 1; // we're now inside the entries `[`
  let line = src.slice(0, pos).split("\n").length;
  const lines: number[] = [];
  for (; pos < src.length && depth > 0; pos++) {
    const ch = src[pos];
    if (ch === "\n") line++;
    else if (ch === "{") {
      if (depth === 1) lines.push(line);
      depth++;
    } else if (ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return lines;
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
  // When --changed is honored, render `scoped / full` side-by-side so it's
  // immediately obvious how much of the repo-wide drift the diff touches.
  const sideBySide = opts.changed && summary.scopedToChanges;
  const sxs = (scoped: number, full: number) =>
    sideBySide ? `${scoped} (scoped) / ${full} (full repo)` : `${scoped}`;

  lines.push("");
  lines.push(`i18n allowlist report  ${tick(summary.ok)} ${summary.ok ? "PASS" : "FAIL"}`);
  lines.push(`  path:       ${summary.reportPath}`);
  if (summary.scopeNote) lines.push(summary.scopeNote);
  lines.push(
    `  schemaOk:   ${tick(summary.schemaOk)} (${summary.totals.schemaErrors} error${summary.totals.schemaErrors === 1 ? "" : "s"})`,
  );
  lines.push(`  driftOk:    ${tick(summary.driftOk)}`);
  lines.push(`  entries:    ${sxs(summary.totals.entries, summary.fullTotals.entries)}`);
  lines.push(
    `  missing:    ${sxs(summary.missingCount, summary.fullTotals.missing)}  (unallowlisted disables)`,
  );
  lines.push(
    `  stale:      ${sxs(summary.staleCount, summary.fullTotals.stale)}  (entries with no source match)`,
  );
  if (!summary.ok && summary.failure) {
    lines.push(`  reason:     ${formatFailureReason(summary.failure, summary)}`);
  }
  return lines.join("\n");
}

/**
 * Machine-readable view of the summary — emitted by `--json` so CI tools
 * can consume the schema/drift/missing/stale verdict + failure breakdown
 * without parsing the pretty text. Stable, intentionally narrow shape.
 */
export interface SummaryJSON {
  ok: boolean;
  schemaOk: boolean;
  driftOk: boolean;
  scopedToChanges: boolean;
  reportPath: string;
  /** Counts as displayed (scoped when scoping active, full otherwise). */
  counts: { entries: number; schemaErrors: number; missing: number; stale: number };
  /** Always the repo-wide counts, regardless of scoping. */
  fullCounts: { entries: number; schemaErrors: number; missing: number; stale: number };
  failure: {
    category: FailureCategory;
    topFiles: string[];
    /** Same single-line string printed under `reason:` in pretty output. */
    reason: string;
  } | null;
}

export function toJSON(summary: Summary): SummaryJSON {
  return {
    ok: summary.ok,
    schemaOk: summary.schemaOk,
    driftOk: summary.driftOk,
    scopedToChanges: summary.scopedToChanges,
    reportPath: summary.reportPath,
    counts: summary.totals,
    fullCounts: summary.fullTotals,
    failure: summary.failure
      ? {
          category: summary.failure.category,
          topFiles: summary.failure.topFiles,
          reason: formatFailureReason(summary.failure, summary),
        }
      : null,
  };
}

/**
 * Emit GitHub Actions workflow commands (`::error file=…,line=…::msg`) for
 * the top offending file paths surfaced by the failure reason. Returns an
 * empty array when the summary passes. drift-missing entries arrive as
 * `file:line` strings; schema + drift-stale are file-only.
 */
export function formatAnnotations(summary: Summary): string[] {
  if (summary.ok || !summary.failure) return [];
  const reason = formatFailureReason(summary.failure, summary);
  const esc = (s: string) =>
    s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  // schema + drift-missing both encode line as `file:line` in topFiles;
  // drift-stale stays file-only.
  const supportsLine =
    summary.failure.category === "drift-missing" ||
    summary.failure.category === "schema";
  return summary.failure.topFiles.map((entry) => {
    let file = entry;
    let line: number | undefined;
    if (supportsLine) {
      const m = entry.match(/^(.*):(\d+)$/);
      if (m) {
        file = m[1];
        line = Number(m[2]);
      }
    }
    const loc = line !== undefined ? `file=${file},line=${line}` : `file=${file}`;
    return `::error ${loc}::i18n allowlist — ${esc(reason)}`;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// CLI entry — only runs when this file is the process entry point so the
// helpers above can be imported by tests without side effects.
// ────────────────────────────────────────────────────────────────────────────
function isMain(): boolean {
  try {
    const here = fileURLToPath(import.meta.url);
    const entry = process.argv[1] ? resolve(process.argv[1]) : "";
    return entry === here;
  } catch {
    return false;
  }
}

/**
 * Parse `--topFiles N` (or `--topFiles=N`) out of an argv. Exported for
 * tests; clamps invalid / missing values to the documented default.
 */
export function parseTopFilesArg(argv: string[], fallback = DEFAULT_TOP_N): number {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let raw: string | undefined;
    if (a === "--topFiles" || a === "--top-files") raw = argv[i + 1];
    else if (a.startsWith("--topFiles=")) raw = a.slice("--topFiles=".length);
    else if (a.startsWith("--top-files=")) raw = a.slice("--top-files=".length);
    if (raw !== undefined) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 1) return n;
      return fallback;
    }
  }
  return fallback;
}

if (isMain()) {
  const ROOT = process.cwd();
  const REPORT_PATH = join(ROOT, "reports", "i18n-allowlist-report.json");
  const SUMMARY_JSON_PATH = join(ROOT, "reports", "i18n-allowlist-summary.json");
  const ALLOWLIST_JSON_PATH = join(ROOT, ALLOWLIST_CONFIG);
  const CHANGED = process.argv.includes("--changed");
  const JSON_OUT = process.argv.includes("--json");
  const ANNOTATIONS = process.argv.includes("--annotations");
  const TOP_N = parseTopFilesArg(process.argv);

  runAllowlistCheck({ silent: true });

  const reportRel = relative(ROOT, REPORT_PATH) || REPORT_PATH;

  // Lookup used by buildFailureReason to attach the allowlist JSON line
  // to each schema-failing entry. Best-effort; missing/invalid JSON just
  // degrades to a file-only annotation.
  const entryLineLookup = (() => {
    if (!existsSync(ALLOWLIST_JSON_PATH)) return undefined;
    try {
      const src = readFileSync(ALLOWLIST_JSON_PATH, "utf8");
      const lines = findAllowlistEntryLines(src);
      return (idx: number) => lines[idx];
    } catch {
      return undefined;
    }
  })();

  if (!existsSync(REPORT_PATH)) {
    if (JSON_OUT) {
      const empty: SummaryJSON = {
        ok: false,
        schemaOk: false,
        driftOk: false,
        scopedToChanges: false,
        reportPath: reportRel,
        counts: { entries: 0, schemaErrors: 0, missing: 0, stale: 0 },
        fullCounts: { entries: 0, schemaErrors: 0, missing: 0, stale: 0 },
        failure: {
          category: "unknown",
          topFiles: [],
          reason:
            "report file was not written (allowlist script crashed before emitting JSON)",
        },
      };
      const body = JSON.stringify(empty, null, 2);
      console.log(body);
      try {
        writeFileSync(SUMMARY_JSON_PATH, body);
      } catch {
        /* artifact write is best-effort */
      }
    } else {
      console.log("");
      console.log("i18n allowlist report  ❌ FAIL");
      console.log(`  path:       ${reportRel}`);
      console.log(
        "  reason:     report file was not written (allowlist script crashed before emitting JSON)",
      );
      console.log("");
    }
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as AllowlistReport;
  const summary = buildSummary(report, reportRel, {
    changed: CHANGED ? getChangedFiles() : undefined,
    topN: TOP_N,
    entryLineLookup,
  });

  // Always persist the machine-readable summary so other CI tooling
  // (check runs, dashboards, downstream jobs) can fetch it as an artifact
  // regardless of whether --json was requested on stdout.
  try {
    writeFileSync(SUMMARY_JSON_PATH, JSON.stringify(toJSON(summary), null, 2));
  } catch {
    /* best-effort */
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(toJSON(summary), null, 2));
  } else {
    console.log(formatSummary(summary, { changed: CHANGED }));
    console.log("");
  }

  if (ANNOTATIONS) {
    for (const a of formatAnnotations(summary)) console.error(a);
  }

  if (!summary.ok) process.exit(1);
}
