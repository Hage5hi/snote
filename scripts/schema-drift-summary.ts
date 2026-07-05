#!/usr/bin/env bun
/**
 * schema-drift-summary
 *
 * Print a concise human-readable summary of missing / mistyped / extra
 * keys from a saved `--validation-report` JSON straight to the terminal.
 * Sibling to schema-drift-pr-comment.ts (which emits Markdown); this one
 * is optimized for `less`/`grep` and quick local debugging.
 *
 * Usage:
 *   bun scripts/schema-drift-summary.ts <report.json> [--browser <n>] [--path <s>]
 *                                       [--kind missing|mistyped|extra|parseError]
 *                                       [--max <n>]
 *
 * Uses the same deterministic sort + filter helpers as the PR-comment
 * script, so `--max` truncation picks the identical top-N entries.
 */
import { readFileSync } from "node:fs";

import {
  selectFailures,
  type FilterOpts,
  type Kind,
  type Report,
} from "./schema-drift-pr-comment";

export type SummaryOpts = FilterOpts & { max?: number; groupByBrowser?: boolean };

function countKinds(f: import("./schema-drift-pr-comment").FileEntry) {
  return {
    missing: f.missing?.length ?? 0,
    mistyped: f.mistyped?.length ?? 0,
    extra: f.extra?.length ?? 0,
    parseError: f.parseError ? 1 : 0,
  };
}

export function renderSummary(r: Report, opts: SummaryOpts = {}): string {
  const bad = selectFailures(r, opts);
  if (bad.length === 0) {
    return `OK   ${r.totals.ok}/${r.totals.checked} manifest(s) valid (strict=${r.strict})\n`;
  }
  const MAX = opts.max ?? Infinity;
  const lines: string[] = [];
  lines.push(
    `FAIL ${r.totals.invalid}/${r.totals.checked} invalid (strict=${r.strict})`,
  );
  if (opts.groupByBrowser) {
    const subtotals = new Map<string, { files: number; missing: number; mistyped: number; extra: number; parseError: number }>();
    for (const f of bad) {
      const key = f.combined ? "combined" : (f.browser ?? "unknown");
      const c = countKinds(f);
      const s = subtotals.get(key) ?? { files: 0, missing: 0, mistyped: 0, extra: 0, parseError: 0 };
      s.files++; s.missing += c.missing; s.mistyped += c.mistyped; s.extra += c.extra; s.parseError += c.parseError;
      subtotals.set(key, s);
    }
    lines.push("  subtotals by browser:");
    for (const k of [...subtotals.keys()].sort()) {
      const s = subtotals.get(k)!;
      lines.push(`    ${k}: ${s.files} file(s)  missing=${s.missing} mistyped=${s.mistyped} extra=${s.extra} parseError=${s.parseError}`);
    }
  }
  for (const f of bad.slice(0, MAX)) {
    const scope = f.combined ? "combined" : `browser=${f.browser ?? "?"}`;
    lines.push(`  ${f.path}  [${scope}]`);
    if (f.parseError) lines.push(`    parseError: ${f.parseError}`);
    if (f.missing?.length) lines.push(`    missing: ${f.missing.join(", ")}`);
    if (f.mistyped?.length)
      lines.push(
        `    mistyped: ${f.mistyped
          .map((m) => `${m.key}(want ${m.expected}, got ${m.got})`)
          .join(", ")}`,
      );
    if (f.extra?.length) lines.push(`    extra: ${f.extra.join(", ")}`);
  }
  if (bad.length > MAX)
    lines.push(`  … +${bad.length - MAX} more failure(s) elided (raise --max)`);
  return lines.join("\n") + "\n";
}

function parseArgs(argv: string[]): { reportPath: string; opts: SummaryOpts } {
  const opts: SummaryOpts = {};
  let reportPath = "";
  const kinds: Kind[] = [];
  const need = (i: number, name: string) => {
    const v = argv[i + 1];
    if (v === undefined) { console.error(`missing value for ${name}`); process.exit(2); }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--browser") { opts.browser = need(i, "--browser"); i++; }
    else if (a === "--path") { opts.path = need(i, "--path"); i++; }
    else if (a === "--kind") { kinds.push(need(i, "--kind") as Kind); i++; }
    else if (a === "--max") { opts.max = parseInt(need(i, "--max"), 10); i++; }
    else if (a === "--group-by-browser") { opts.groupByBrowser = true; }
    else if (!reportPath) reportPath = a;
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  if (kinds.length) opts.kind = kinds;
  return { reportPath, opts };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.error(
      "Usage: bun scripts/schema-drift-summary.ts <report.json> " +
        "[--browser <name>] [--path <substr>] [--kind ...] [--max <n>]",
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const { reportPath, opts } = parseArgs(args);
  const r: Report = JSON.parse(readFileSync(reportPath, "utf8"));
  process.stdout.write(renderSummary(r, opts));
}

if (import.meta.main) main();
