#!/usr/bin/env bun
// Parse focus-trap-escape-*.json artifacts and print first-failure
// summaries. Filterable by attempt/browser/spec/label. Also emits a
// machine-readable summary at reports/_ci/focus-trap-inspect-summary.json
// so CI can surface results programmatically.
//
// Usage:
//   bun run scripts/inspect-focus-trap.ts [--attempt N] [--browser chromium|firefox|webkit]
//                                         [--spec SUBSTR] [--label SUBSTR]
//                                         [--out PATH] [FILE ...]
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  CSV_COLUMNS,
  formatIssue,
  renderMarkdown,
  toCsvRow,
  validateFocusTrapPayload,
} from "./_helpers/focus-trap-inspect";

type CsvFilter = "all" | "valid" | "invalid";
type Arg = {
  attempt?: number; browser?: string; spec?: string; label?: string;
  out: string; csv?: string; md?: string;
  csvFilter: CsvFilter;
  validateOnly?: boolean;
  maxErrors?: number;
  scanRoot: string;
  invalidDir?: string;
  files: string[];
};
  invalidDir?: string;
  files: string[];
};
function parseArgs(): Arg {
  const a: Arg = { out: "reports/_ci/focus-trap-inspect-summary.json", csvFilter: "all", scanRoot: "test-results", files: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    switch (v) {
      case "--attempt": a.attempt = Number(argv[++i]); break;
      case "--browser": a.browser = argv[++i]; break;
      case "--spec":    a.spec = argv[++i]; break;
      case "--label":   a.label = argv[++i]; break;
      case "--out":     a.out = argv[++i]; break;
      case "--csv":     a.csv = argv[++i]; break;
      case "--md":      a.md = argv[++i]; break;
      case "--csv-filter": {
        const f = argv[++i] as CsvFilter;
        if (f !== "all" && f !== "valid" && f !== "invalid") { console.error(`--csv-filter must be all|valid|invalid`); process.exit(64); }
        a.csvFilter = f; break;
      }
      case "--validate-only": a.validateOnly = true; break;
      case "--max-errors": {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n < 0) { console.error("--max-errors must be >= 0"); process.exit(64); }
        a.maxErrors = n; break;
      }
      case "--scan-root":     a.scanRoot = argv[++i]; break;
      case "--invalid-dir":   a.invalidDir = argv[++i]; break;
      case "-h": case "--help":
        console.log("bun run scripts/inspect-focus-trap.ts [--attempt N] [--browser NAME] [--spec S] [--label S] [--out PATH] [--csv PATH] [--csv-filter all|valid|invalid] [--md PATH] [--validate-only] [--max-errors N] [--scan-root DIR] [--invalid-dir PATH] [FILE...]");
        process.exit(0);
      default: a.files.push(v);
    }
  }
  if (a.invalidDir == null) a.invalidDir = "reports/_ci/focus-trap-invalid";
  return a;
}


function walk(dir: string, out: string[] = []): string[] {
  let entries: import("node:fs").Dirent[] = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/^focus-trap-escape-.*\.json$/.test(e.name)) out.push(p);
  }
  return out;
}

function meta(file: string) {
  const dir = dirname(file).split("/").pop() || "";
  const browser = (dir.match(/(chromium|firefox|webkit)/) || [])[1] || null;
  const attempt = Number((dir.match(/retry(\d+)/) || [0, 0])[1]);
  const spec = dir.replace(/-(chromium|firefox|webkit)(-retry\d+)?$/, "");
  const label = (file.match(/focus-trap-escape-(.+)\.json$/) || [])[1] || null;
  return { browser, attempt, spec, label };
}

const args = parseArgs();
// Sort deterministically so --validate-only always processes files in
// the same order across runs, which stabilises "first invalid" output.
const all = (args.files.length
  ? args.files.filter((f) => { try { return statSync(f).isFile(); } catch { return false; } })
  : walk(args.scanRoot)
).sort((a, b) => a.localeCompare(b));

const matched = all.filter((f) => {
  const m = meta(f);
  if (args.attempt != null && m.attempt !== args.attempt) return false;
  if (args.browser && m.browser !== args.browser) return false;
  if (args.spec && !m.spec.includes(args.spec)) return false;
  if (args.label && !(m.label || "").includes(args.label)) return false;
  return true;
});

if (!matched.length) {
  console.log("No focus-trap-escape files matched.");
}

// Copy a bad JSON artifact plus its sibling screenshot/HTML into a
// dedicated CI folder so debuggers can jump straight to the broken
// files without grepping the raw upload tree.
function quarantine(file: string, reason: string, dir: string): string {
  try {
    mkdirSync(dir, { recursive: true });
    const base = basename(file, ".json");
    const targetJson = join(dir, `${base}.json`);
    copyFileSync(file, targetJson);
    for (const ext of [".png", ".html"]) {
      const sib = join(dirname(file), `${base}${ext}`);
      if (existsSync(sib)) copyFileSync(sib, join(dir, `${base}${ext}`));
    }
    writeFileSync(join(dir, `${base}.reason.txt`), reason + "\n");
    return targetJson;
  } catch (e) {
    console.log(`  (warn) failed to quarantine ${file}: ${e}`);
    return "";
  }
}

const summary: Array<Record<string, unknown>> = [];
let hadInvalid = false;
let firstInvalidFile: string | null = null;
const invalidFiles: string[] = [];
for (const f of matched) {
  const m = meta(f);
  let p: Record<string, unknown> = {};
  try { p = JSON.parse(readFileSync(f, "utf8")); } catch (e) {
    const reason = `parse error: ${(e as Error).message}`;
    console.log(`\n=== ${f} ===\n  ${reason}`);
    hadInvalid = true;
    firstInvalidFile ??= f;
    invalidFiles.push(f);
    const quarantined = args.invalidDir ? quarantine(f, reason, args.invalidDir) : "";
    summary.push({
      file: f, ...m, testTitle: null, triggerNonce: null,
      firstEscape: null, relocate: null, iterTimings: {},
      artifacts: null, artifactUrls: null,
      failureReason: reason, failureKind: "parse", parseError: (e as Error).message,
      schemaIssues: null, schemaPointer: null, quarantined,
    });
    continue;
  }

  const schemaErrs = validateFocusTrapPayload(p);
  if (schemaErrs.length) {
    const lines = schemaErrs.map(formatIssue);
    console.log(`\n=== ${f} ===\n  ✗ malformed focus-trap-escape payload:`);
    for (const l of lines) console.log(`    - ${l}`);
    hadInvalid = true;
    firstInvalidFile ??= f;
    invalidFiles.push(f);
    const reason = `schema: ${lines.join(" | ")}`;
    const quarantined = args.invalidDir ? quarantine(f, reason, args.invalidDir) : "";
    summary.push({
      file: f, ...m, testTitle: p.testTitle ?? null, triggerNonce: p.triggerNonce ?? null,
      firstEscape: null, relocate: null, iterTimings: {},
      artifacts: null, artifactUrls: null,
      failureReason: reason, failureKind: "schema", parseError: null,
      schemaIssues: schemaErrs, schemaPointer: schemaErrs[0]?.pointer ?? null, quarantined,
    });
    continue;
  }

  if (args.validateOnly) {
    // Still emit a healthy entry so the summary JSON reflects every
    // scanned file, but skip the verbose per-file console block.
    summary.push({
      file: f, ...m, testTitle: p.testTitle ?? null, triggerNonce: p.triggerNonce ?? null,
      firstEscape: null, relocate: null, iterTimings: {},
      artifacts: null, artifactUrls: null,
      failureReason: "", failureKind: null, parseError: null,
      schemaIssues: null, schemaPointer: null, quarantined: "",
    });
    continue;
  }

  const hist = (p.focusHistory as Array<Record<string, unknown>>) || [];
  const firstEscape = hist.find((e) => {
    const snap = (e.snapshot || e.after || e.before) as Record<string, unknown> | undefined;
    const active = (snap?.active ?? snap) as Record<string, unknown> | undefined;
    return active && active.insideDialog === false;
  });
  const relocate = (p.lastRelocate as Record<string, unknown>) || null;

  console.log(`\n=== ${f} ===`);
  console.log(`  meta:          browser=${m.browser}  attempt=${m.attempt}  spec=${m.spec}  label=${m.label}`);
  console.log(`  testTitle:     ${p.testTitle ?? "?"}`);
  console.log(`  triggerNonce:  ${p.triggerNonce ?? "?"}`);
  if (firstEscape) {
    console.log(`  first escape:  ${firstEscape.event} @ perf=${firstEscape.perf}`);
    console.log(`    snapshot:    ${JSON.stringify(firstEscape.snapshot ?? firstEscape.after ?? firstEscape.before)}`);
  } else {
    console.log("  first escape:  (none)");
  }
  if (relocate) console.log(`  relocate:      path=${relocate.path} usedFallback=${relocate.usedFallback}`);
  const timings = (p.iterTimings as Record<string, Record<string, number | null>>) || {};
  for (const [k, t] of Object.entries(timings)) {
    console.log(`  ${k}: openMs=${t.openMs ?? "-"} closeMs=${t.closeMs ?? "-"} totalMs=${t.totalMs ?? "-"}`);
  }

  summary.push({
    file: f,
    ...m,
    testTitle: p.testTitle ?? null,
    triggerNonce: p.triggerNonce ?? null,
    firstEscape: firstEscape
      ? { event: firstEscape.event, perf: firstEscape.perf, snapshot: firstEscape.snapshot ?? firstEscape.after ?? firstEscape.before }
      : null,
    relocate,
    iterTimings: timings,
    artifacts: p.artifacts ?? null,
    artifactUrls: p.artifactUrls ?? null,
    // failureReason is always present so CI can filter programmatically:
    // parse:*, schema:*, "" (healthy), or the label of a matched escape.
    failureReason: firstEscape ? (m.label ?? "") : "",
    failureKind: firstEscape ? "escape" : null,
    parseError: null,
    schemaIssues: null,
    schemaPointer: null,
    quarantined: "",
  });
}

const validCount = summary.filter((e) => e.failureKind == null || e.failureKind === "escape").length;
const invalidCount = summary.length - validCount;

// --validate-only walks every matched file in deterministic order, then
// exits nonzero if any were invalid — reporting the first one for quick
// triage. CSV/MD are skipped by default; downstream consumers can still
// read the summary JSON.
if (args.validateOnly) {
  console.log(`\n▶ validate-only: scanned ${matched.length}  valid=${validCount}  invalid=${invalidCount}`);
  if (hadInvalid) {
    console.log(`✗ first invalid: ${firstInvalidFile}`);
    // Persist a summary even on failure so CI can surface the details.
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify({
      generatedAt: new Date().toISOString(), mode: "validate-only",
      scanned: all.length, matched: matched.length,
      valid: validCount, invalid: invalidCount,
      firstInvalidFile, invalidFiles, entries: summary,
    }, null, 2));
    process.exit(2);
  }
  console.log(`✓ validated ${matched.length} focus-trap-escape file(s)`);
  process.exit(0);
}

const summaryDoc = {
  generatedAt: new Date().toISOString(),
  filters: { attempt: args.attempt ?? null, browser: args.browser ?? null, spec: args.spec ?? null, label: args.label ?? null },
  matched: matched.length,
  scanned: all.length,
  valid: validCount,
  invalid: invalidCount,
  invalidDir: args.invalidDir ?? null,
  entries: summary,
};
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, JSON.stringify(summaryDoc, null, 2));
console.log(`\n▶ Wrote summary: ${args.out} (matched ${matched.length}/${all.length}  valid=${validCount}  invalid=${invalidCount})`);

if (args.csv) {
  const filtered = summary.filter((e) => {
    const isInvalid = e.failureKind === "parse" || e.failureKind === "schema";
    if (args.csvFilter === "valid")   return !isInvalid;
    if (args.csvFilter === "invalid") return isInvalid;
    return true;
  });
  const rows = filtered.map(toCsvRow);
  mkdirSync(dirname(args.csv), { recursive: true });
  writeFileSync(args.csv, [CSV_COLUMNS.join(","), ...rows].join("\n") + "\n");
  console.log(`▶ Wrote CSV:     ${args.csv}  (filter=${args.csvFilter}, rows=${rows.length})`);
}

// Emit a short markdown report and, when running inside GitHub Actions,
// also append it to the job's step summary so on-call can scan the
// first failures without opening artifacts.
const md = renderMarkdown(summaryDoc);
if (args.md) {
  mkdirSync(dirname(args.md), { recursive: true });
  writeFileSync(args.md, md);
  console.log(`▶ Wrote markdown: ${args.md}`);
}
const stepSummary = process.env.GITHUB_STEP_SUMMARY;
if (stepSummary) {
  try {
    const fs = await import("node:fs/promises");
    await fs.appendFile(stepSummary, md + "\n");
  } catch { /* best-effort */ }
}

// Fail fast on malformed artifacts so CI surfaces bad inputs rather
// than pretending everything is fine with an empty summary.
if (hadInvalid) process.exit(2);

