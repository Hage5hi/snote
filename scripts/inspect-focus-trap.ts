#!/usr/bin/env bun
// Parse every focus-trap-escape-*.json produced by the install-prompt
// e2e suite and print, per file: the first failing focus checkpoint,
// per-iteration timings, and which relocateInstallTrigger fallback path
// was used. Zero-config: scans `test-results/` by default.
//
// Usage:
//   bun run scripts/inspect-focus-trap.ts                        # scan test-results/
//   bun run scripts/inspect-focus-trap.ts path/to/file.json ...  # explicit files
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

const args = process.argv.slice(2);
const files = args.length
  ? args.filter((f) => statSync(f).isFile())
  : walk("test-results");

if (!files.length) {
  console.log("No focus-trap-escape-*.json files found under test-results/.");
  process.exit(0);
}

for (const f of files) {
  console.log(`\n=== ${f} ===`);
  let p: Record<string, unknown>;
  try { p = JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { console.log(`  parse error: ${e}`); continue; }

  console.log(`  label:        ${p.label ?? "?"}`);
  console.log(`  testTitle:    ${p.testTitle ?? "?"}`);
  console.log(`  triggerNonce: ${p.triggerNonce ?? "?"}`);

  const hist = (p.focusHistory as Array<Record<string, unknown>>) || [];
  const firstEscape = hist.find((e) => {
    const snap = (e.snapshot || e.after || e.before) as Record<string, unknown> | undefined;
    const active = (snap?.active ?? snap) as Record<string, unknown> | undefined;
    return active && active.insideDialog === false;
  });
  if (firstEscape) {
    console.log(`  first escape checkpoint: ${firstEscape.event} @ perf=${firstEscape.perf}`);
    console.log(`    snapshot: ${JSON.stringify(firstEscape.snapshot ?? firstEscape.after ?? firstEscape.before)}`);
  } else {
    console.log("  first escape checkpoint: (none found in history)");
  }

  const relocate = (p.lastRelocate as Record<string, unknown>) || null;
  if (relocate) {
    console.log(`  relocate path: ${relocate.path} (usedFallback=${relocate.usedFallback})`);
    if (relocate.matched) console.log(`    matched: ${JSON.stringify(relocate.matched)}`);
  } else {
    console.log("  relocate path: (never invoked)");
  }

  const timings = (p.iterTimings as Record<string, Record<string, number | null>>) || {};
  const keys = Object.keys(timings);
  if (keys.length) {
    console.log("  iterTimings:");
    for (const k of keys) {
      const t = timings[k];
      console.log(`    ${k}: openMs=${t.openMs ?? "-"}  closeMs=${t.closeMs ?? "-"}  totalMs=${t.totalMs ?? "-"}`);
    }
  }

  const art = (p.artifacts as Record<string, string | null>) || {};
  if (art.screenshot || art.pageHtml) {
    console.log(`  artifacts: screenshot=${art.screenshot ?? "-"}  html=${art.pageHtml ?? "-"}`);
  }
}
