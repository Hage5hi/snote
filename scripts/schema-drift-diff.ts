#!/usr/bin/env bun
/**
 * schema-drift-diff
 *
 * Compare two `--validation-report` JSON files and print what changed in
 * the top failures: added / removed / changed rows, plus a re-computed
 * stable anchor for each (via `anchorFor`) so reviewers can jump straight
 * into pr-comment.md for the matching row.
 *
 * Usage:
 *   bun scripts/schema-drift-diff.ts <before.json> <after.json>
 *                                    [--browser <name>] [--path <substr>]
 *                                    [--kind ...] [--max <n>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  anchorFor,
  selectFailures,
  type FileEntry,
  type FilterOpts,
  type Kind,
  type Report,
} from "./schema-drift-pr-comment";

export type DiffOpts = FilterOpts & { max?: number };

function fingerprint(f: FileEntry): string {
  return JSON.stringify({
    p: f.parseError ?? null,
    m: [...(f.missing ?? [])].sort(),
    t: [...(f.mistyped ?? [])]
      .map((x) => `${x.key}:${x.expected}:${x.got}`)
      .sort(),
    e: [...(f.extra ?? [])].sort(),
  });
}

function keyOf(f: FileEntry): string {
  return `${f.path}\u0000${f.combined ? "combined" : (f.browser ?? "")}`;
}

export type DiffResult = {
  totals: {
    before: { checked: number; invalid: number };
    after: { checked: number; invalid: number };
    added: number;
    removed: number;
    changed: number;
    matched: number;
  };
  added: Array<{ path: string; browser: string | null; combined: boolean; anchor: string }>;
  removed: Array<{ path: string; browser: string | null; combined: boolean; anchor: string }>;
  changed: Array<{
    path: string;
    browser: string | null;
    combined: boolean;
    anchor: string;
    missing: { added: string[]; removed: string[] };
    extra: { added: string[]; removed: string[] };
    mistyped: { added: string[]; removed: string[] };
    parseError: { before: string | null; after: string | null } | null;
  }>;
  matchedAnchors: string[];
};

function scopeOf(f: FileEntry) {
  return { browser: f.browser ?? null, combined: Boolean(f.combined) };
}

function diffList(was: string[], now: string[]) {
  const wasSet = new Set(was); const nowSet = new Set(now);
  return { added: now.filter((x) => !wasSet.has(x)), removed: was.filter((x) => !nowSet.has(x)) };
}

export function computeDiff(before: Report, after: Report, opts: DiffOpts = {}): DiffResult {
  const b = new Map(selectFailures(before, opts).map((f) => [keyOf(f), f]));
  const a = new Map(selectFailures(after, opts).map((f) => [keyOf(f), f]));
  const added: FileEntry[] = [];
  const removed: FileEntry[] = [];
  const changed: Array<{ before: FileEntry; after: FileEntry }> = [];
  const matched: string[] = [];
  for (const [k, f] of a) {
    if (!b.has(k)) added.push(f);
    else {
      matched.push(anchorFor(f));
      if (fingerprint(b.get(k)!) !== fingerprint(f)) changed.push({ before: b.get(k)!, after: f });
    }
  }
  for (const [k, f] of b) if (!a.has(k)) removed.push(f);
  matched.sort();
  return {
    totals: {
      before: { checked: before.totals.checked, invalid: before.totals.invalid },
      after: { checked: after.totals.checked, invalid: after.totals.invalid },
      added: added.length, removed: removed.length, changed: changed.length, matched: matched.length,
    },
    added: added.map((f) => ({ path: f.path, ...scopeOf(f), anchor: anchorFor(f) })),
    removed: removed.map((f) => ({ path: f.path, ...scopeOf(f), anchor: anchorFor(f) })),
    changed: changed.map(({ before: bf, after: af }) => ({
      path: af.path, ...scopeOf(af), anchor: anchorFor(af),
      missing: diffList(bf.missing ?? [], af.missing ?? []),
      extra: diffList(bf.extra ?? [], af.extra ?? []),
      mistyped: diffList(
        (bf.mistyped ?? []).map((m) => `${m.key}:${m.expected}→${m.got}`),
        (af.mistyped ?? []).map((m) => `${m.key}:${m.expected}→${m.got}`),
      ),
      parseError: (bf.parseError ?? null) !== (af.parseError ?? null)
        ? { before: bf.parseError ?? null, after: af.parseError ?? null } : null,
    })),
    matchedAnchors: matched,
  };
}

export function renderDiff(before: Report, after: Report, opts: DiffOpts = {}): string {
  const d = computeDiff(before, after, opts);
  const MAX = opts.max ?? Infinity;
  const lines: string[] = [];
  lines.push(
    `schema-drift diff: before=${d.totals.before.invalid}/${d.totals.before.checked} → after=${d.totals.after.invalid}/${d.totals.after.checked}`,
    `  +${d.totals.added} added  -${d.totals.removed} removed  ~${d.totals.changed} changed`,
  );
  const emit = (label: string, list: Array<{ path: string; browser: string | null; combined: boolean; anchor: string }>) => {
    if (!list.length) return;
    lines.push(`\n${label}:`);
    for (const f of list.slice(0, MAX)) {
      const scope = f.combined ? "combined" : `browser=${f.browser ?? "?"}`;
      lines.push(`  ${f.path}  [${scope}]  #${f.anchor}`);
    }
    if (list.length > MAX) lines.push(`  … +${list.length - MAX} more`);
  };
  emit("added", d.added);
  emit("removed", d.removed);
  if (d.changed.length) {
    lines.push("\nchanged:");
    for (const c of d.changed.slice(0, MAX)) {
      const scope = c.combined ? "combined" : `browser=${c.browser ?? "?"}`;
      lines.push(`  ${c.path}  [${scope}]  #${c.anchor}`);
      const dl = (name: string, x: { added: string[]; removed: string[] }) => {
        if (x.added.length || x.removed.length)
          lines.push(`    ${name}: +[${x.added.join(", ")}] -[${x.removed.join(", ")}]`);
      };
      dl("missing", c.missing); dl("extra", c.extra); dl("mistyped", c.mistyped);
      if (c.parseError)
        lines.push(`    parseError: ${c.parseError.before ?? "∅"} → ${c.parseError.after ?? "∅"}`);
    }
    if (d.changed.length > MAX) lines.push(`  … +${d.changed.length - MAX} more`);
  }
  if (d.matchedAnchors.length) {
    lines.push(`\nstable anchors (matched in both reports, ${d.matchedAnchors.length}):`);
    for (const s of d.matchedAnchors.slice(0, MAX)) lines.push(`  #${s}`);
    if (d.matchedAnchors.length > MAX) lines.push(`  … +${d.matchedAnchors.length - MAX} more`);
  }
  return lines.join("\n") + "\n";
}

export function renderDiffMarkdown(before: Report, after: Report, opts: DiffOpts = {}): string {
  return "```\n" + renderDiff(before, after, opts) + "```\n";
}

// Exit codes:
//   0 = success   2 = bad CLI usage   3 = report file missing / unreadable
//   4 = report file is not valid JSON   5 = report file is missing required fields
function loadReport(path: string, label: string): Report {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e: any) {
    console.error(
      `error: cannot read ${label} report at "${path}": ${e?.code ?? e?.message ?? e}\n` +
      `  fix: pass the path to a saved validation-report.json (see docs/schema-drift-ci-artifacts.md),\n` +
      `       or download it: gh run download <run-id> -n schema-drift-fixture-validation`,
    );
    process.exit(3);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (e: any) {
    console.error(
      `error: ${label} report at "${path}" is not valid JSON: ${e?.message ?? e}\n` +
      `  fix: regenerate with \`schema-drift-view.sh --validation-report <path>\``,
    );
    process.exit(4);
  }
  const r = parsed as Partial<Report>;
  const problems: string[] = [];
  if (!r || typeof r !== "object") problems.push("root is not an object");
  if (r && typeof (r as any).strict !== "boolean") problems.push("`strict` (boolean) is missing");
  if (!r || typeof r.totals !== "object" || r.totals === null) problems.push("`totals` (object) is missing");
  else {
    for (const k of ["checked", "ok", "invalid"] as const)
      if (typeof (r.totals as any)[k] !== "number") problems.push(`\`totals.${k}\` (number) is missing`);
  }
  if (!Array.isArray(r?.files)) problems.push("`files` (array) is missing");
  if (problems.length) {
    console.error(
      `error: ${label} report at "${path}" is missing required fields:\n` +
      problems.map((p) => `  - ${p}`).join("\n") + "\n" +
      `  fix: this file must be the JSON produced by \`schema-drift-view.sh --validation-report\`.\n` +
      `       Expected shape: { strict: boolean, totals: { checked, ok, invalid }, files: [...] }`,
    );
    process.exit(5);
  }
  return r as Report;
}

function parseArgs(argv: string[]): { before: string; after: string; out: string; markdown: boolean; json: boolean; dryRun: boolean; opts: DiffOpts } {
  const opts: DiffOpts = {};
  const positional: string[] = [];
  const kinds: Kind[] = [];
  let out = ""; let markdown = false; let json = false; let dryRun = false;
  const need = (i: number, name: string) => {
    const v = argv[i + 1];
    if (v === undefined) { console.error(`error: missing value for ${name}`); process.exit(2); }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--browser") { opts.browser = need(i, "--browser"); i++; }
    else if (a === "--path") { opts.path = need(i, "--path"); i++; }
    else if (a === "--kind") { kinds.push(need(i, "--kind") as Kind); i++; }
    else if (a === "--max") { opts.max = parseInt(need(i, "--max"), 10); i++; }
    else if (a === "--out") { out = need(i, "--out"); i++; }
    else if (a.startsWith("--out=")) out = a.slice(6);
    else if (a === "--markdown") markdown = true;
    else if (a === "--json") json = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--")) { console.error(`error: unknown arg: ${a}`); process.exit(2); }
    else positional.push(a);
  }
  if (kinds.length) opts.kind = kinds;
  if (positional.length !== 2) {
    console.error("Usage: bun scripts/schema-drift-diff.ts <before.json> <after.json> [flags]");
    process.exit(2);
  }
  if (json && markdown) {
    console.error("error: --json and --markdown are mutually exclusive");
    process.exit(2);
  }
  return { before: positional[0], after: positional[1], out, markdown, json, dryRun, opts };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.error(
      "Usage: bun scripts/schema-drift-diff.ts <before.json> <after.json> " +
        "[--browser <name>] [--path <substr>] [--kind ...] [--max <n>] " +
        "[--out <path>] [--markdown] [--json] [--dry-run]",
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const { before, after, out, markdown, json, dryRun, opts } = parseArgs(args);
  const b = loadReport(before, "before");
  const a = loadReport(after, "after");
  const wantMd = markdown || (out && out.endsWith(".md"));
  const body = json
    ? JSON.stringify(computeDiff(b, a, opts), null, 2) + "\n"
    : wantMd ? renderDiffMarkdown(b, a, opts) : renderDiff(b, a, opts);
  if (dryRun) {
    process.stderr.write(`dry-run: would write ${out || "<stdout>"} (${body.length} bytes)\n`);
    process.stdout.write(body);
    return;
  }
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, body);
    console.error(`schema-drift diff: ${out}`);
  } else {
    process.stdout.write(body);
  }
}

if (import.meta.main) main();
