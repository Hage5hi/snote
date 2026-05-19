// Local CLI: run the i18n allowlist check (silently) and print a concise
// summary read straight from reports/i18n-allowlist-report.json.
//
// Usage:
//   bun run i18n:allowlist:report
//
// Output: report path + the four counters (schemaOk, driftOk, missing,
// stale). Exits 1 when the report indicates failure so it can be wired
// into pre-commit hooks if desired.
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { runAllowlistCheck } from "./i18n-allowlist-check";

const ROOT = process.cwd();
const REPORT_PATH = join(ROOT, "reports", "i18n-allowlist-report.json");

// Run silently so our own output isn't drowned out.
runAllowlistCheck({ silent: true });

if (!existsSync(REPORT_PATH)) {
  console.error(`❌ Report not found at ${relative(ROOT, REPORT_PATH)}`);
  process.exit(1);
}

interface R {
  ok: boolean;
  schemaOk: boolean;
  driftOk: boolean;
  totals: { entries: number; schemaErrors: number; missing: number; stale: number };
}
const r = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as R;

const tick = (b: boolean) => (b ? "✅" : "❌");
console.log("");
console.log(`i18n allowlist report  ${tick(r.ok)} ${r.ok ? "PASS" : "FAIL"}`);
console.log(`  path:       ${relative(ROOT, REPORT_PATH)}`);
console.log(`  schemaOk:   ${tick(r.schemaOk)} (${r.totals.schemaErrors} error${r.totals.schemaErrors === 1 ? "" : "s"})`);
console.log(`  driftOk:    ${tick(r.driftOk)}`);
console.log(`  entries:    ${r.totals.entries}`);
console.log(`  missing:    ${r.totals.missing}  (unallowlisted disables)`);
console.log(`  stale:      ${r.totals.stale}  (entries with no source match)`);
console.log("");

if (!r.ok) process.exit(1);
