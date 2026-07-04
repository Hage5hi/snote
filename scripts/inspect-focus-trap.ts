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
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Arg = { attempt?: number; browser?: string; spec?: string; label?: string; out: string; csv?: string; files: string[] };
function parseArgs(): Arg {
  const a: Arg = { out: "reports/_ci/focus-trap-inspect-summary.json", files: [] };
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
      case "-h": case "--help":
        console.log("bun run scripts/inspect-focus-trap.ts [--attempt N] [--browser NAME] [--spec S] [--label S] [--out PATH] [--csv PATH] [FILE...]");
        process.exit(0);
      default: a.files.push(v);
    }
  }
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
const all = args.files.length
  ? args.files.filter((f) => { try { return statSync(f).isFile(); } catch { return false; } })
  : walk("test-results");

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

const summary: Array<Record<string, unknown>> = [];
for (const f of matched) {
  const m = meta(f);
  let p: Record<string, unknown> = {};
  try { p = JSON.parse(readFileSync(f, "utf8")); } catch (e) { console.log(`\n=== ${f} ===\n  parse error: ${e}`); continue; }

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
  });
}

mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, JSON.stringify({
  generatedAt: new Date().toISOString(),
  filters: { attempt: args.attempt ?? null, browser: args.browser ?? null, spec: args.spec ?? null, label: args.label ?? null },
  matched: matched.length,
  scanned: all.length,
  entries: summary,
}, null, 2));
console.log(`\n▶ Wrote summary: ${args.out} (matched ${matched.length}/${all.length})`);

if (args.csv) {
  const cols = [
    "file", "spec", "browser", "attempt", "label", "testTitle",
    "firstEscapeEvent", "firstEscapePerfMs",
    "relocatePath", "relocateUsedFallback",
    "iterCount",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = summary.map((r) => {
    const fe = (r.firstEscape as Record<string, unknown> | null) || null;
    const rl = (r.relocate as Record<string, unknown> | null) || null;
    return [
      r.file, r.spec, r.browser, r.attempt, r.label, r.testTitle,
      fe?.event ?? "", fe?.perf ?? "",
      rl?.path ?? "", rl?.usedFallback ?? "",
      Object.keys((r.iterTimings as object) || {}).length,
    ].map(esc).join(",");
  });
  mkdirSync(dirname(args.csv), { recursive: true });
  writeFileSync(args.csv, [cols.join(","), ...rows].join("\n") + "\n");
  console.log(`▶ Wrote CSV:     ${args.csv}`);
}

