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

export function renderDiff(before: Report, after: Report, opts: DiffOpts = {}): string {
  const b = new Map(selectFailures(before, opts).map((f) => [keyOf(f), f]));
  const a = new Map(selectFailures(after, opts).map((f) => [keyOf(f), f]));
  const added: FileEntry[] = [];
  const removed: FileEntry[] = [];
  const changed: Array<{ before: FileEntry; after: FileEntry }> = [];
  for (const [k, f] of a) {
    if (!b.has(k)) added.push(f);
    else if (fingerprint(b.get(k)!) !== fingerprint(f))
      changed.push({ before: b.get(k)!, after: f });
  }
  for (const [k, f] of b) if (!a.has(k)) removed.push(f);
  const MAX = opts.max ?? Infinity;
  const lines: string[] = [];
  lines.push(
    `schema-drift diff: before=${before.totals.invalid}/${before.totals.checked} → after=${after.totals.invalid}/${after.totals.checked}`,
    `  +${added.length} added  -${removed.length} removed  ~${changed.length} changed`,
  );
  const emit = (label: string, list: FileEntry[]) => {
    if (!list.length) return;
    lines.push(`\n${label}:`);
    for (const f of list.slice(0, MAX)) {
      const scope = f.combined ? "combined" : `browser=${f.browser ?? "?"}`;
      lines.push(`  ${f.path}  [${scope}]  #${anchorFor(f)}`);
    }
    if (list.length > MAX) lines.push(`  … +${list.length - MAX} more`);
  };
  emit("added", added);
  emit("removed", removed);
  if (changed.length) {
    lines.push("\nchanged:");
    for (const { before: bf, after: af } of changed.slice(0, MAX)) {
      const scope = af.combined ? "combined" : `browser=${af.browser ?? "?"}`;
      lines.push(`  ${af.path}  [${scope}]  #${anchorFor(af)}`);
      const diffList = (name: string, was: string[], now: string[]) => {
        const wasSet = new Set(was); const nowSet = new Set(now);
        const add = now.filter((x) => !wasSet.has(x));
        const rm = was.filter((x) => !nowSet.has(x));
        if (add.length || rm.length)
          lines.push(`    ${name}: +[${add.join(", ")}] -[${rm.join(", ")}]`);
      };
      diffList("missing", bf.missing ?? [], af.missing ?? []);
      diffList("extra", bf.extra ?? [], af.extra ?? []);
      diffList(
        "mistyped",
        (bf.mistyped ?? []).map((m) => `${m.key}:${m.expected}→${m.got}`),
        (af.mistyped ?? []).map((m) => `${m.key}:${m.expected}→${m.got}`),
      );
      if ((bf.parseError ?? null) !== (af.parseError ?? null))
        lines.push(`    parseError: ${bf.parseError ?? "∅"} → ${af.parseError ?? "∅"}`);
    }
    if (changed.length > MAX) lines.push(`  … +${changed.length - MAX} more`);
  }
  return lines.join("\n") + "\n";
}

export function renderDiffMarkdown(before: Report, after: Report, opts: DiffOpts = {}): string {
  return "```\n" + renderDiff(before, after, opts) + "```\n";
}

function parseArgs(argv: string[]): { before: string; after: string; out: string; markdown: boolean; opts: DiffOpts } {
  const opts: DiffOpts = {};
  const positional: string[] = [];
  const kinds: Kind[] = [];
  let out = "";
  let markdown = false;
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
    else if (a === "--out") { out = need(i, "--out"); i++; }
    else if (a.startsWith("--out=")) out = a.slice(6);
    else if (a === "--markdown") markdown = true;
    else if (a.startsWith("--")) { console.error(`unknown arg: ${a}`); process.exit(2); }
    else positional.push(a);
  }
  if (kinds.length) opts.kind = kinds;
  if (positional.length !== 2) {
    console.error("Usage: bun scripts/schema-drift-diff.ts <before.json> <after.json> [flags]");
    process.exit(2);
  }
  return { before: positional[0], after: positional[1], out, markdown, opts };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.error(
      "Usage: bun scripts/schema-drift-diff.ts <before.json> <after.json> " +
        "[--browser <name>] [--path <substr>] [--kind ...] [--max <n>]",
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const { before, after, out, markdown, opts } = parseArgs(args);
  const b: Report = JSON.parse(readFileSync(before, "utf8"));
  const a: Report = JSON.parse(readFileSync(after, "utf8"));
  const body = markdown || (out && out.endsWith(".md"))
    ? renderDiffMarkdown(b, a, opts)
    : renderDiff(b, a, opts);
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, body);
    console.error(`schema-drift diff: ${out}`);
  } else {
    process.stdout.write(body);
  }
}

if (import.meta.main) main();
