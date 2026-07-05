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
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  anchorFor,
  selectFailures,
  type FileEntry,
  type FilterOpts,
  type Kind,
  type Report,
} from "./schema-drift-pr-comment";

export type DiffOpts = FilterOpts & { max?: number; failSlugs?: string[] };

const ALL_KINDS: Kind[] = ["missing", "mistyped", "extra", "parseError"];

/**
 * Compile a filter pattern to a predicate. Supported forms:
 *   - `/regex/flags` — anchored RegExp (use `.*` explicitly for partial)
 *   - contains `*` or `?` — glob (e.g. `fail-chromium-*`)
 *   - anything else — exact string match
 */
export function compileMatcher(pattern: string): (v: string) => boolean {
  const rx = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);
  if (rx) {
    const re = new RegExp(rx[1], rx[2]);
    return (v) => re.test(v);
  }
  if (/[*?]/.test(pattern)) {
    const src =
      "^" +
      pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") +
      "$";
    const re = new RegExp(src);
    return (v) => re.test(v);
  }
  return (v) => v === pattern;
}

function matchesAny(value: string, patterns: string[] | null): boolean {
  if (!patterns) return true;
  for (const p of patterns) if (compileMatcher(p)(value)) return true;
  return false;
}

/** Expand kind patterns (`*`, `parse*`, `/^p/`) against ALL_KINDS. */
export function expandKindPatterns(patterns: string[]): Kind[] {
  const out = new Set<Kind>();
  for (const p of patterns) {
    const m = compileMatcher(p);
    for (const k of ALL_KINDS) if (m(k)) out.add(k);
  }
  return [...out];
}

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
  const slugs = opts.failSlugs && opts.failSlugs.length ? opts.failSlugs : null;
  const keepA = (x: { anchor: string }) => matchesAny(x.anchor, slugs);
  const aList = added.map((f) => ({ path: f.path, ...scopeOf(f), anchor: anchorFor(f) })).filter(keepA);
  const rList = removed.map((f) => ({ path: f.path, ...scopeOf(f), anchor: anchorFor(f) })).filter(keepA);
  const cList = changed.map(({ before: bf, after: af }) => ({
    path: af.path, ...scopeOf(af), anchor: anchorFor(af),
    missing: diffList(bf.missing ?? [], af.missing ?? []),
    extra: diffList(bf.extra ?? [], af.extra ?? []),
    mistyped: diffList(
      (bf.mistyped ?? []).map((m) => `${m.key}:${m.expected}→${m.got}`),
      (af.mistyped ?? []).map((m) => `${m.key}:${m.expected}→${m.got}`),
    ),
    parseError: (bf.parseError ?? null) !== (af.parseError ?? null)
      ? { before: bf.parseError ?? null, after: af.parseError ?? null } : null,
  })).filter(keepA);
  const matchedFiltered = slugs ? matched.filter((s) => matchesAny(s, slugs)) : matched;
  return {
    totals: {
      before: { checked: before.totals.checked, invalid: before.totals.invalid },
      after: { checked: after.totals.checked, invalid: after.totals.invalid },
      added: aList.length, removed: rList.length, changed: cList.length, matched: matchedFiltered.length,
    },
    added: aList, removed: rList, changed: cList,
    matchedAnchors: matchedFiltered,
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
function loadReport(path: string, label: string, jsonErrors = false): Report {
  const fail = (code: number, kind: string, message: string, extra: Record<string, unknown> = {}, fix = "") => {
    if (jsonErrors) {
      process.stderr.write(
        JSON.stringify({ error: kind, code, label, path, message, fix, ...extra }, null, 2) + "\n",
      );
    } else {
      console.error(`error: ${message}` + (fix ? `\n  fix: ${fix}` : ""));
    }
    process.exit(code);
  };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e: any) {
    fail(
      3, "report-unreadable",
      `cannot read ${label} report at "${path}": ${e?.code ?? e?.message ?? e}`,
      { errno: e?.code ?? null },
      `pass the path to a saved validation-report.json, or download it: gh run download <run-id> -n schema-drift-fixture-validation`,
    );
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw!); }
  catch (e: any) {
    fail(
      4, "report-invalid-json",
      `${label} report at "${path}" is not valid JSON: ${e?.message ?? e}`,
      {},
      `regenerate with \`schema-drift-view.sh --validation-report <path>\``,
    );
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
    const receivedKeys = r && typeof r === "object" ? Object.keys(r as object) : [];
    const expected = ["strict", "totals", "files"] as const;
    const missingTop = expected.filter((k) => !receivedKeys.includes(k));
    const checklist = expected.map((k) => ({ key: k, present: receivedKeys.includes(k) }));
    if (jsonErrors) {
      process.stderr.write(
        JSON.stringify(
          {
            error: "report-missing-fields",
            code: 5, label, path,
            message: `${label} report at "${path}" is missing required fields`,
            problems,
            receivedTopLevelKeys: receivedKeys,
            missingTopLevelKeys: missingTop,
            expectedChecklist: checklist,
            expectedShape: "{ strict: boolean, totals: { checked, ok, invalid }, files: [...] }",
            fix: "this file must be the JSON produced by `schema-drift-view.sh --validation-report`",
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      const clText = expected
        .map((k) => `    ${receivedKeys.includes(k) ? "[x]" : "[ ]"} ${k}`)
        .join("\n");
      console.error(
        `error: ${label} report at "${path}" is missing required fields:\n` +
          problems.map((p) => `  - ${p}`).join("\n") + "\n" +
          `  received top-level keys: ${receivedKeys.length ? receivedKeys.join(", ") : "(none)"}\n` +
          (missingTop.length ? `  missing top-level keys: ${missingTop.join(", ")}\n` : "") +
          `  expected schema checklist:\n${clText}\n` +
          `  fix: this file must be the JSON produced by \`schema-drift-view.sh --validation-report\`.\n` +
          `       Expected shape: { strict: boolean, totals: { checked, ok, invalid }, files: [...] }`,
      );
    }
    process.exit(5);
  }
  return r as Report;
}

function parseArgs(argv: string[]): {
  before: string; after: string; out: string; jsonOut: string;
  markdown: boolean; json: boolean; dryRun: boolean; validateJson: boolean;
  opts: DiffOpts;
} {
  const opts: DiffOpts = {};
  const positional: string[] = [];
  const kindPatterns: string[] = [];
  const failSlugs: string[] = [];
  let out = ""; let jsonOut = "";
  let markdown = false; let json = false; let dryRun = false; let validateJson = false;
  const need = (i: number, name: string) => {
    const v = argv[i + 1];
    if (v === undefined) { console.error(`error: missing value for ${name}`); process.exit(2); }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--browser") { opts.browser = need(i, "--browser"); i++; }
    else if (a === "--path") { opts.path = need(i, "--path"); i++; }
    else if (a === "--kind") { kindPatterns.push(...need(i, "--kind").split(",")); i++; }
    else if (a.startsWith("--kind=")) kindPatterns.push(...a.slice(7).split(","));
    else if (a === "--max") { opts.max = parseInt(need(i, "--max"), 10); i++; }
    else if (a === "--out") { out = need(i, "--out"); i++; }
    else if (a.startsWith("--out=")) out = a.slice(6);
    else if (a === "--json-out") { jsonOut = need(i, "--json-out"); i++; }
    else if (a.startsWith("--json-out=")) jsonOut = a.slice(11);
    else if (a === "--markdown") markdown = true;
    else if (a === "--json") json = true;
    else if (a === "--validate-json") validateJson = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--fail-slug") { failSlugs.push(...need(i, "--fail-slug").split(",")); i++; }
    else if (a.startsWith("--fail-slug=")) failSlugs.push(...a.slice(12).split(","));
    else if (a.startsWith("--")) { console.error(`error: unknown arg: ${a}`); process.exit(2); }
    else positional.push(a);
  }
  if (kindPatterns.length) {
    const expanded = expandKindPatterns(kindPatterns.map((p) => p.trim()).filter(Boolean));
    if (!expanded.length) {
      console.error(`error: --kind pattern(s) matched no known kinds (${ALL_KINDS.join("|")}): ${kindPatterns.join(", ")}`);
      process.exit(2);
    }
    opts.kind = expanded;
  }
  if (failSlugs.length) opts.failSlugs = failSlugs.map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
  if (positional.length !== 2) {
    console.error("Usage: bun scripts/schema-drift-diff.ts <before.json> <after.json> [flags]");
    process.exit(2);
  }
  if (json && markdown) {
    console.error("error: --json and --markdown are mutually exclusive");
    process.exit(2);
  }
  if (jsonOut) json = true;
  return { before: positional[0], after: positional[1], out, jsonOut, markdown, json, dryRun, validateJson, opts };
}

function validateJsonPayload(payload: unknown, schemaPath: string): { ok: true } | { ok: false; errors: unknown } {
  const AjvMod = require("ajv");
  const Ajv = AjvMod.default ?? AjvMod;
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const ok = validate(payload) as boolean;
  return ok ? { ok: true } : { ok: false, errors: validate.errors };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--print-schema")) {
    const schemaPath = resolve(__dirname, "../schemas/schema-drift-diff.schema.json");
    process.stdout.write(readFileSync(schemaPath, "utf8"));
    if (!readFileSync(schemaPath, "utf8").endsWith("\n")) process.stdout.write("\n");
    return;
  }
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    const schemaRel = "schemas/schema-drift-diff.schema.json";
    console.error(
      "Usage: bun scripts/schema-drift-diff.ts <before.json> <after.json> " +
        "[--browser <name>] [--path <substr>] [--kind <pat>] [--fail-slug <pat>] " +
        "[--max <n>] [--out <path>] [--json-out <path>] [--markdown] [--json] " +
        "[--validate-json] [--dry-run] [--print-schema]\n" +
        "\n" +
        "  --kind / --fail-slug accept exact values, `*`/`?` globs, or `/regex/flags`.\n" +
        "  --json-out writes the --json payload atomically (implies --json).\n" +
        "  --validate-json checks the JSON output against " + schemaRel + ".\n" +
        "  --print-schema prints that JSON Schema to stdout and exits.\n" +
        "\n" +
        "Examples:\n" +
        "  # Text diff of two reports\n" +
        "  bun scripts/schema-drift-diff.ts before.json after.json\n" +
        "\n" +
        "  # JSON to stdout, validated against " + schemaRel + "\n" +
        "  bun scripts/schema-drift-diff.ts before.json after.json --json --validate-json\n" +
        "\n" +
        "  # Atomic JSON write to a file (implies --json)\n" +
        "  bun scripts/schema-drift-diff.ts before.json after.json --json-out /tmp/diff.json\n" +
        "\n" +
        "  # Wildcard filter: every chromium failure in one flag\n" +
        "  bun scripts/schema-drift-diff.ts before.json after.json --json --fail-slug 'fail-chromium-*'\n" +
        "\n" +
        "  # /regex/flags with case-insensitive match on the anchor\n" +
        "  bun scripts/schema-drift-diff.ts before.json after.json --fail-slug '/^fail-(chromium|webkit)-/i'\n" +
        "\n" +
        "  # --kind glob expands `mis*` to both `missing` and `mistyped`\n" +
        "  bun scripts/schema-drift-diff.ts before.json after.json --kind 'mis*'\n" +
        "\n" +
        "  # Print the JSON Schema for programmatic use\n" +
        "  bun scripts/schema-drift-diff.ts --print-schema > diff.schema.json",
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const { before, after, out, jsonOut, markdown, json, dryRun, validateJson, opts } = parseArgs(args);
  const b = loadReport(before, "before", json);
  const a = loadReport(after, "after", json);
  const wantMd = markdown || (out && out.endsWith(".md"));
  const payload = json ? computeDiff(b, a, opts) : null;
  const body = json
    ? JSON.stringify(payload, null, 2) + "\n"
    : wantMd ? renderDiffMarkdown(b, a, opts) : renderDiff(b, a, opts);

  if (validateJson) {
    if (!json) {
      console.error("error: --validate-json requires --json (or --json-out)");
      process.exit(2);
    }
    const schemaPath = resolve(__dirname, "../schemas/schema-drift-diff.schema.json");
    // Test hook: force an invalid payload to exercise the failure branch.
    const toCheck = process.env.SCHEMA_DRIFT_DIFF_FORCE_INVALID ? { totals: "nope" } : payload;
    const result = validateJsonPayload(toCheck, schemaPath);
    if (!result.ok) {
      const ajvErrors = (result.errors as Array<Record<string, unknown>> | null) ?? [];
      const expectedChecklist = [
        "totals", "added", "removed", "changed", "matchedAnchors",
      ].map((key) => ({
        key,
        present: !!toCheck && typeof toCheck === "object" && key in (toCheck as object),
      }));
      const errPayload = {
        error: "json-schema-mismatch",
        code: 6,
        schemaPath,
        message: "--json output does not match schema",
        ajvErrors: ajvErrors.map((e) => ({
          instancePath: e.instancePath ?? e.dataPath ?? "",
          schemaPath: e.schemaPath ?? "",
          keyword: e.keyword ?? "",
          message: e.message ?? "",
          params: e.params ?? {},
        })),
        expectedChecklist,
        fix: "regenerate the diff without --validate-json and inspect the JSON output; the schema is schemas/schema-drift-diff.schema.json",
      };
      process.stderr.write(JSON.stringify(errPayload, null, 2) + "\n");
      process.exit(6);
    }
    process.stderr.write(`validate-json: OK (${schemaPath})\n`);
  }

  if (dryRun) {
    process.stderr.write(`dry-run: would write ${out || jsonOut || "<stdout>"} (${body.length} bytes)\n`);
    process.stdout.write(body);
    return;
  }
  if (jsonOut) {
    atomicWrite(jsonOut, body, "json-out");
    console.error(`schema-drift diff (json): ${jsonOut}`);
  } else if (out) {
    atomicWrite(out, body, "out");
    console.error(`schema-drift diff: ${out}`);
  } else {
    process.stdout.write(body);
  }
}

/**
 * Write `body` to `dest` atomically: mkdir -p, write to a sibling `.tmp`
 * file, then rename over the destination. Exits 7 with a clear message
 * when the parent directory cannot be created or the file cannot be
 * written (e.g. destination is not writable).
 */
function atomicWrite(dest: string, body: string, label: string) {
  const abs = resolve(dest);
  const tmp = `${abs}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(tmp, body);
    renameSync(tmp, abs);
  } catch (e: any) {
    try { unlinkSync(tmp); } catch {}
    console.error(
      `error: cannot write ${label} to "${dest}": ${e?.code ?? e?.message ?? e}\n` +
      `  fix: check that the parent directory exists and is writable, or pass a different --${label} path`,
    );
    process.exit(7);
  }
}

if (import.meta.main) main();
