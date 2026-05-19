// Local CLI: run the i18n allowlist check (silently) and print a concise
// summary read straight from reports/i18n-allowlist-report.json.
//
// Usage:
//   bun run i18n:allowlist:summary
//   bun run i18n:allowlist:summary --changed
//
// Flags:
//   --changed    Only print results scoped to files changed in the working
//                tree (git diff --name-only, includes staged + unstaged).
//                When no i18n-relevant files have changed, falls back to
//                the full report and says so.
//
// Output always includes:
//   • the absolute / relative path to reports/i18n-allowlist-report.json
//   • the four counters (schemaOk, driftOk, missing, stale)
//   • on failure: a single one-line reason explaining the non-zero exit
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, relative } from "node:path";
import { runAllowlistCheck } from "./i18n-allowlist-check";

const ROOT = process.cwd();
const REPORT_PATH = join(ROOT, "reports", "i18n-allowlist-report.json");
const CHANGED = process.argv.includes("--changed");

// Run silently so our own output isn't drowned out.
runAllowlistCheck({ silent: true });

const reportRel = relative(ROOT, REPORT_PATH) || REPORT_PATH;

if (!existsSync(REPORT_PATH)) {
  console.log("");
  console.log(`i18n allowlist report  ❌ FAIL`);
  console.log(`  path:       ${reportRel}`);
  console.log(`  reason:     report file was not written (allowlist script crashed before emitting JSON)`);
  console.log("");
  process.exit(1);
}

interface EntryReport {
  index: number;
  file: string;
  reason: string;
  errors: string[];
  matchedSites: { file: string; line: number }[];
}
interface R {
  ok: boolean;
  schemaOk: boolean;
  driftOk: boolean;
  totals: { entries: number; schemaErrors: number; missing: number; stale: number };
  entries: EntryReport[];
  missing: { file: string; reason: string; line: number }[];
  stale: string[];
}
const r = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as R;

/** Files changed in the working tree (staged + unstaged + untracked-tracked). */
function changedFiles(): string[] | null {
  try {
    const out = execSync("git diff --name-only HEAD", { encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

const tick = (b: boolean) => (b ? "✅" : "❌");

let scopedNote = "";
let scopedTotals = r.totals;
let scopedOk = r.ok;
let scopedSchemaOk = r.schemaOk;
let scopedDriftOk = r.driftOk;
let scopedMissingCount = r.totals.missing;
let scopedStaleCount = r.totals.stale;

if (CHANGED) {
  const changed = changedFiles();
  if (!changed) {
    scopedNote = "  scope:      --changed requested, but `git diff` failed — falling back to FULL report";
  } else {
    const changedSet = new Set(changed.map((f) => f.replaceAll("\\", "/")));
    const isRelevant = (f: string) =>
      changedSet.has(f) ||
      [...changedSet].some(
        (c) => c === ".lintrc-i18n-allowlist.json" || c === ".lintrc-i18n-allowlist.schema.json",
      );

    // Scope missing/stale to changed files only.
    const scopedMissing = r.missing.filter((m) => isRelevant(m.file));
    const scopedStale = r.stale.filter((k) => isRelevant(k.split("::")[0]));
    const scopedEntries = r.entries.filter(
      (e) => isRelevant(e.file) || e.matchedSites.some((s) => isRelevant(s.file)),
    );

    const relevantTouched =
      scopedEntries.length > 0 ||
      scopedMissing.length > 0 ||
      scopedStale.length > 0 ||
      changedSet.has(".lintrc-i18n-allowlist.json") ||
      changedSet.has(".lintrc-i18n-allowlist.schema.json");

    if (!relevantTouched) {
      scopedNote = `  scope:      --changed (${changed.length} file(s) changed, none i18n-relevant) — falling back to FULL report`;
    } else {
      scopedNote = `  scope:      --changed (${scopedEntries.length} entry/entries + ${scopedMissing.length} missing + ${scopedStale.length} stale relevant to your diff)`;
      scopedTotals = {
        entries: scopedEntries.length,
        schemaErrors: r.totals.schemaErrors, // schema is global; always reported
        missing: scopedMissing.length,
        stale: scopedStale.length,
      };
      scopedMissingCount = scopedMissing.length;
      scopedStaleCount = scopedStale.length;
      // Schema is repo-wide and must always be valid; drift is scoped.
      scopedSchemaOk = r.schemaOk;
      scopedDriftOk = scopedMissing.length === 0 && scopedStale.length === 0;
      scopedOk = scopedSchemaOk && scopedDriftOk;
    }
  }
}

console.log("");
console.log(`i18n allowlist report  ${tick(scopedOk)} ${scopedOk ? "PASS" : "FAIL"}`);
console.log(`  path:       ${reportRel}`);
if (scopedNote) console.log(scopedNote);
console.log(`  schemaOk:   ${tick(scopedSchemaOk)} (${scopedTotals.schemaErrors} error${scopedTotals.schemaErrors === 1 ? "" : "s"})`);
console.log(`  driftOk:    ${tick(scopedDriftOk)}`);
console.log(`  entries:    ${scopedTotals.entries}${CHANGED && !scopedNote.includes("FULL") ? " (scoped)" : ""}`);
console.log(`  missing:    ${scopedMissingCount}  (unallowlisted disables)`);
console.log(`  stale:      ${scopedStaleCount}  (entries with no source match)`);

if (!scopedOk) {
  // One-line failure reason — pick the most actionable signal.
  let reason: string;
  if (!scopedSchemaOk) {
    reason = `schema validation failed (${scopedTotals.schemaErrors} error${scopedTotals.schemaErrors === 1 ? "" : "s"} in .lintrc-i18n-allowlist.json)`;
  } else if (scopedMissingCount > 0) {
    reason = `${scopedMissingCount} unallowlisted no-restricted-syntax disable${scopedMissingCount === 1 ? "" : "s"} found in source`;
  } else if (scopedStaleCount > 0) {
    reason = `${scopedStaleCount} stale allowlist entr${scopedStaleCount === 1 ? "y has" : "ies have"} no matching disable comment`;
  } else {
    reason = "allowlist check reported failure (see report for details)";
  }
  console.log(`  reason:     ${reason}`);
  console.log("");
  process.exit(1);
}

console.log("");
