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
  REQUIRED_DIFF_CSV_COLUMNS,
  formatIssue,
  renderMarkdown,
  toCsvRow,
  validateDiffCsvHeader,
  validateFocusTrapPayload,
  validateJsonReport,
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
  jsonReport?: string;
  diffWith?: string;
  diffOut?: string;
  diffRetries: number;
  diffRetryDelayMs: number;
  htmlReport?: string;
  topN: number;
  artifactValidUrl?: string;
  artifactInvalidUrl?: string;
  files: string[];
};



function parseArgs(): Arg {
  const a: Arg = { out: "reports/_ci/focus-trap-inspect-summary.json", csvFilter: "all", scanRoot: "test-results", topN: 5, diffRetries: 3, diffRetryDelayMs: 500, files: [] };
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
      case "--json-report":   a.jsonReport = argv[++i]; break;
      case "--diff-with":     a.diffWith = argv[++i]; break;
      case "--diff-out":      a.diffOut = argv[++i]; break;
      case "--diff-retries": {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n < 0) { console.error("--diff-retries must be >= 0"); process.exit(64); }
        a.diffRetries = n; break;
      }
      case "--diff-retry-delay-ms": {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n < 0) { console.error("--diff-retry-delay-ms must be >= 0"); process.exit(64); }
        a.diffRetryDelayMs = n; break;
      }
      case "--html-report":   a.htmlReport = argv[++i]; break;

      case "--top": {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n < 1) { console.error("--top must be >= 1"); process.exit(64); }
        a.topN = n; break;
      }
      case "--artifact-valid-url":   a.artifactValidUrl = argv[++i]; break;
      case "--artifact-invalid-url": a.artifactInvalidUrl = argv[++i]; break;
      case "-h": case "--help":
        console.log("bun run scripts/inspect-focus-trap.ts [--attempt N] [--browser NAME] [--spec S] [--label S] [--out PATH] [--csv PATH] [--csv-filter all|valid|invalid] [--md PATH] [--validate-only] [--max-errors N] [--scan-root DIR] [--invalid-dir PATH] [--json-report PATH] [--diff-with DIR] [--diff-out PATH] [--top N] [--artifact-valid-url URL] [--artifact-invalid-url URL] [FILE...]");
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
const canReport = () => args.maxErrors == null || invalidFiles.length < args.maxErrors;
for (const f of matched) {
  const m = meta(f);
  let p: Record<string, unknown> = {};
  try { p = JSON.parse(readFileSync(f, "utf8")); } catch (e) {
    const reason = `parse error: ${(e as Error).message}`;
    if (canReport()) console.log(`\n=== ${f} ===\n  ${reason}`);
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
    if (canReport()) {
      console.log(`\n=== ${f} ===\n  ✗ malformed focus-trap-escape payload:`);
      for (const l of lines) console.log(`    - ${l}`);
    }
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
  const capped = args.maxErrors != null && invalidCount > args.maxErrors;
  console.log(`\n▶ validate-only: scanned ${matched.length}  valid=${validCount}  invalid=${invalidCount}${capped ? `  (reporting capped at --max-errors=${args.maxErrors})` : ""}`);
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

// --json-report writes a focused machine-readable summary (valid/invalid
// counts plus every schema/parse issue) alongside the full summary JSON,
// so downstream CI jobs don't have to re-parse the verbose entries doc.
if (args.jsonReport) {
  // Sort by file so downstream diffs are stable across runs regardless
  // of filesystem walk order.
  const bySortedFile = [...summary].sort((a, b) => String(a.file).localeCompare(String(b.file)));
  const artifacts = bySortedFile.map((e) => ({
    file: String(e.file),
    failureKind: (e.failureKind as string | null) ?? null,
    failureReason: String(e.failureReason ?? ""),
    schemaPointer: (e.schemaPointer as string | null) ?? null,
    quarantined: String(e.quarantined ?? ""),
  }));
  const issues = bySortedFile
    .filter((e) => e.failureKind === "parse" || e.failureKind === "schema")
    .map((e) => ({
      file: String(e.file),
      failureKind: e.failureKind,
      failureReason: String(e.failureReason ?? ""),
      schemaPointer: (e.schemaPointer as string | null) ?? null,
      schemaIssues: e.schemaIssues ?? null,
      parseError: (e.parseError as string | null) ?? null,
      quarantined: String(e.quarantined ?? ""),
    }));
  // Run metadata (git SHA, scan-root, argv, timestamp) so a report can
  // always be traced back to the exact CI invocation that produced it.
  const gitSha = process.env.GITHUB_SHA
    || (() => { try { return require("node:child_process").execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } })();
  const meta = {
    gitSha,
    scanRoot: args.scanRoot,
    invalidDir: args.invalidDir ?? null,
    argv: process.argv.slice(2),
    timestamp: summaryDoc.generatedAt,
    ciRunId: process.env.GITHUB_RUN_ID ?? null,
    ciRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  };
  const report = {
    generatedAt: summaryDoc.generatedAt,
    meta,
    scanned: all.length, matched: matched.length,
    valid: validCount, invalid: invalidCount,
    invalidDir: args.invalidDir ?? null,
    artifacts,
    issues,
  };
  // Schema-validate before writing so a shape drift fails fast instead
  // of shipping a broken artifact to downstream jobs.
  const requiredArtifactKeys = ["file", "failureKind", "failureReason", "schemaPointer", "quarantined"] as const;
  const requiredTopKeys = ["generatedAt", "meta", "scanned", "matched", "valid", "invalid", "artifacts", "issues"] as const;
  for (const k of requiredTopKeys) if (!(k in report)) { console.error(`--json-report: missing required top-level key '${k}'`); process.exit(65); }
  if (typeof report.valid !== "number" || typeof report.invalid !== "number") { console.error("--json-report: valid/invalid must be numbers"); process.exit(65); }
  for (const a of report.artifacts) for (const k of requiredArtifactKeys) if (!(k in a)) { console.error(`--json-report: artifact missing required key '${k}': ${JSON.stringify(a)}`); process.exit(65); }
  mkdirSync(dirname(args.jsonReport), { recursive: true });
  writeFileSync(args.jsonReport, JSON.stringify(report, null, 2));
  console.log(`▶ Wrote JSON report: ${args.jsonReport} (artifacts=${artifacts.length} issues=${issues.length})`);
}



// --diff-with compares the current summary against a previous run's
// downloaded CSVs (looks for *.valid.csv / *.invalid.csv under the given
// directory). Emits rows whose failureReason or schemaPointer changed.
type DiffRow = { file: string; prev: { failureReason: string; schemaPointer: string }; curr: { failureReason: string; schemaPointer: string } };
let diffRows: DiffRow[] = [];
if (args.diffWith) {
  const prev = new Map<string, { failureReason: string; schemaPointer: string }>();
  void CSV_COLUMNS; // legacy indexer kept as reference for header validation below

  const parseCsv = (text: string) => {
    // Minimal CSV parser matching escCsv (RFC 4180 quotes + doubled quotes).
    const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c === "\r") { /* skip */ }
      else cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.length > 1);
  };
  const walkCsv = (dir: string): string[] => {
    const out: string[] = [];
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...walkCsv(p));
        else if (/\.(valid|invalid)\.csv$/.test(e.name)) out.push(p);
      }
    } catch { /* missing dir → empty diff */ }
    return out;
  };
  // Retry/backoff around the previous-run artifact read so a transient
  // CI hiccup (still-syncing artifact mount, brief NFS blip, etc.)
  // doesn't kill the diff. Uses exponential backoff capped by
  // --diff-retries / --diff-retry-delay-ms.
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  let csvPaths: string[] = [];
  for (let attempt = 0; attempt <= args.diffRetries; attempt++) {
    try {
      if (!existsSync(args.diffWith)) throw new Error(`diff-with dir missing: ${args.diffWith}`);
      csvPaths = walkCsv(args.diffWith);
      if (csvPaths.length) break;
      throw new Error(`no *.valid.csv / *.invalid.csv under ${args.diffWith}`);
    } catch (e) {
      if (attempt === args.diffRetries) {
        console.log(`  (warn) diff-with read failed after ${attempt + 1} attempt(s): ${(e as Error).message}`);
        break;
      }
      const delay = args.diffRetryDelayMs * Math.pow(2, attempt);
      console.log(`  (retry) diff-with attempt ${attempt + 1} failed (${(e as Error).message}); sleeping ${delay}ms`);
      await sleep(delay);
    }
  }
  for (const csvPath of csvPaths) {
    const rows = parseCsv(readFileSync(csvPath, "utf8"));
    const header = rows.shift();
    if (!header) continue;
    // Validate the previous CSV header carries the columns we depend on.
    if (!header.includes("file") || !header.includes("failureReason")) {
      console.log(`  (warn) skipping ${csvPath}: missing required columns (file, failureReason)`);
      continue;
    }
    const prevFileIdx = header.indexOf("file");
    const prevReasonIdx = header.indexOf("failureReason");
    for (const r of rows) {
      const file = r[prevFileIdx] ?? "";
      const reason = r[prevReasonIdx] ?? "";
      const ptr = reason.startsWith("schema:") ? (reason.match(/\/[\w[\]/-]*/)?.[0] ?? "") : "";
      if (file) prev.set(file, { failureReason: reason, schemaPointer: ptr });
    }
  }
  for (const e of summary) {
    const file = String(e.file);
    const currReason = String(e.failureReason ?? "");
    const currPtr = String(e.schemaPointer ?? "");
    const p = prev.get(file) ?? { failureReason: "", schemaPointer: "" };
    if (p.failureReason !== currReason || p.schemaPointer !== currPtr) {
      diffRows.push({ file, prev: p, curr: { failureReason: currReason, schemaPointer: currPtr } });
    }
  }
  // Sort by file so diff-out is byte-stable across runs.
  diffRows.sort((a, b) => a.file.localeCompare(b.file));

  console.log(`\n▶ Diff vs ${args.diffWith}: ${diffRows.length} changed row(s)`);
  for (const d of diffRows.slice(0, 20)) {
    console.log(`  ~ ${d.file}\n      prev: ${d.prev.failureReason || "—"} ${d.prev.schemaPointer ? `(${d.prev.schemaPointer})` : ""}\n      curr: ${d.curr.failureReason || "—"} ${d.curr.schemaPointer ? `(${d.curr.schemaPointer})` : ""}`);
  }
  if (args.diffOut) {
    // Stable CSV format so consumers can diff two runs' diff-outs directly.
    // Header + one row per changed artifact, sorted by file.
    const REQUIRED_DIFF_COLUMNS = ["file", "prevFailureReason", "prevSchemaPointer", "currFailureReason", "currSchemaPointer"] as const;
    const header: string[] = [...REQUIRED_DIFF_COLUMNS];
    // Schema-validate the header before writing (guards against
    // accidental column-drift in this file).
    for (const c of REQUIRED_DIFF_COLUMNS) if (!header.includes(c)) { console.error(`--diff-out: missing required column '${c}'`); process.exit(65); }
    const rows = diffRows.map((d) => [d.file, d.prev.failureReason, d.prev.schemaPointer, d.curr.failureReason, d.curr.schemaPointer]);
    const csv = [header, ...rows].map((r) => r.map((v) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n") + "\n";
    mkdirSync(dirname(args.diffOut), { recursive: true });
    writeFileSync(args.diffOut, csv);
    console.log(`▶ Wrote diff CSV: ${args.diffOut}`);
  }
}

// --html-report renders a lightweight standalone triage page from the
// summary: top-N failureKind / schemaPointer bars + a table of
// quarantined files linking directly to the copies under --invalid-dir.
if (args.htmlReport) {
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const kindMap = new Map<string, number>();
  const ptrMap = new Map<string, number>();
  const quarantined: Array<{ file: string; quarantined: string; failureReason: string; schemaPointer: string }> = [];
  for (const e of summary) {
    const k = (e.failureKind as string | null) ?? "";
    if (k && k !== "escape") kindMap.set(k, (kindMap.get(k) ?? 0) + 1);
    const p = (e.schemaPointer as string | null) ?? "";
    if (p) ptrMap.set(p, (ptrMap.get(p) ?? 0) + 1);
    const q = String(e.quarantined ?? "");
    if (q) quarantined.push({ file: String(e.file), quarantined: q, failureReason: String(e.failureReason ?? ""), schemaPointer: p });
  }
  const topN = args.topN;
  const topKinds = [...kindMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topN);
  const topPtrs  = [...ptrMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topN);
  quarantined.sort((a, b) => a.file.localeCompare(b.file));
  const row = (k: string, c: number) => `<tr><td>${c}</td><td><code>${esc(k)}</code></td></tr>`;
  const qRow = (q: typeof quarantined[number]) => `<tr><td><code>${esc(q.file)}</code></td><td><a href="${esc(q.quarantined)}"><code>${esc(q.quarantined)}</code></a></td><td><code>${esc(q.schemaPointer || "—")}</code></td><td>${esc(q.failureReason || "—")}</td></tr>`;
  const html = `<!doctype html><meta charset="utf-8"><title>Focus-trap triage</title>
<style>body{font:14px/1.4 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem}h1{margin-top:0}h2{margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.25rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.35rem .5rem;text-align:left;vertical-align:top}code{background:#f4f4f4;padding:0 .25rem;border-radius:3px}.k{color:#555}</style>
<h1>Focus-trap triage</h1>
<p class="k">Scanned <b>${all.length}</b> · matched <b>${matched.length}</b> · ✅ valid <b>${validCount}</b> · ❌ invalid <b>${invalidCount}</b> · quarantine dir: <code>${esc(args.invalidDir ?? "")}</code></p>
<h2>Top ${topKinds.length} failureKind</h2>
<table><thead><tr><th>count</th><th>failureKind</th></tr></thead><tbody>${topKinds.map(([k, c]) => row(k, c)).join("") || "<tr><td colspan=2>—</td></tr>"}</tbody></table>
<h2>Top ${topPtrs.length} schemaPointer</h2>
<table><thead><tr><th>count</th><th>schemaPointer</th></tr></thead><tbody>${topPtrs.map(([k, c]) => row(k, c)).join("") || "<tr><td colspan=2>—</td></tr>"}</tbody></table>
<h2>Quarantined artifacts (${quarantined.length})</h2>
<table><thead><tr><th>original</th><th>quarantined copy</th><th>schemaPointer</th><th>failureReason</th></tr></thead><tbody>${quarantined.map(qRow).join("") || "<tr><td colspan=4>None.</td></tr>"}</tbody></table>
`;
  mkdirSync(dirname(args.htmlReport), { recursive: true });
  writeFileSync(args.htmlReport, html);
  console.log(`▶ Wrote HTML report: ${args.htmlReport}`);
}


// Emit a short markdown report and, when running inside GitHub Actions,
// also append it to the job's step summary so on-call can scan the
// first failures without opening artifacts.
let md = renderMarkdown(summaryDoc);

// Append top-N breakdowns (separate lists for failureKind and
// schemaPointer) + artifact links + quarantined-file links so on-call
// can triage from the step summary alone.
const topLines: string[] = [];
const kindCounts = new Map<string, number>();
const pointerCounts = new Map<string, number>();
const quarantinedFiles: string[] = [];
for (const e of summary) {
  const kind = (e.failureKind as string | null) ?? "";
  if (kind && kind !== "escape") {
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
  }
  const ptr = (e.schemaPointer as string | null) ?? "";
  if (ptr) pointerCounts.set(ptr, (pointerCounts.get(ptr) ?? 0) + 1);
  const q = String(e.quarantined ?? "");
  if (q) quarantinedFiles.push(q);
}
const topKinds = [...kindCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, args.topN);
const topPtrs  = [...pointerCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, args.topN);
if (topKinds.length) {
  topLines.push("", `### Top ${topKinds.length} failureKind`, "", "| count | failureKind |", "| --- | --- |");
  for (const [k, c] of topKinds) topLines.push(`| ${c} | \`${k}\` |`);
}
if (topPtrs.length) {
  topLines.push("", `### Top ${topPtrs.length} schemaPointer`, "", "| count | schemaPointer |", "| --- | --- |");
  for (const [k, c] of topPtrs) topLines.push(`| ${c} | \`${k}\` |`);
}
if (quarantinedFiles.length) {
  quarantinedFiles.sort((a, b) => a.localeCompare(b));
  topLines.push("", `### Quarantined artifacts (${quarantinedFiles.length})`, "");
  for (const q of quarantinedFiles.slice(0, args.topN)) topLines.push(`- [\`${q}\`](${q})`);
  if (quarantinedFiles.length > args.topN) topLines.push(`- …and ${quarantinedFiles.length - args.topN} more in \`${args.invalidDir}\``);
}
if (args.artifactValidUrl || args.artifactInvalidUrl) {
  topLines.push("", "### Artifacts");
  if (args.artifactValidUrl)   topLines.push(`- ✅ valid CSV: ${args.artifactValidUrl}`);
  if (args.artifactInvalidUrl) topLines.push(`- ❌ invalid CSV: ${args.artifactInvalidUrl}`);
}
if (diffRows.length) {
  topLines.push("", `### Diff vs previous run`, "", `- changed rows: **${diffRows.length}**`);
}
if (topLines.length) md += topLines.join("\n") + "\n";


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


