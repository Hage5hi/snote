#!/usr/bin/env bun
/**
 * schema-drift-pr-comment
 *
 * Local command that generates the same PR-comment Markdown body that CI
 * emits (reports/_ci/schema-drift-fixture/pr-comment.md) from a saved
 * `--validation-report` JSON. Useful for reproducing / debugging the
 * comment offline without re-running the workflow.
 *
 * Usage:
 *   bun scripts/schema-drift-pr-comment.ts <report.json> [--out <path>]
 *
 * Env (mirrors the CI annotation step):
 *   SCHEMA_DRIFT_ANNOTATION_MAX  (default 10)  — rows to include
 *   SCHEMA_DRIFT_MISSING_CAP     (default 20)  — items per "missing" list
 *   SCHEMA_DRIFT_MISTYPED_CAP    (default 20)  — items per "mistyped" list
 *   SCHEMA_DRIFT_EXTRA_CAP       (default 20)  — items per "extra" list
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Mistyped = { key: string; expected: string; got: string };
type FileEntry = {
  path: string;
  ok: boolean;
  browser?: string | null;
  combined?: boolean;
  missing?: string[];
  mistyped?: Mistyped[];
  extra?: string[];
  parseError?: string | null;
};
type Report = {
  strict: boolean;
  totals: { checked: number; ok: number; invalid: number };
  files: FileEntry[];
};

const intEnv = (k: string, d: number) => {
  const n = parseInt(process.env[k] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

const cap = <T>(a: T[] | undefined, n: number): (T | string)[] => {
  const src = a ?? [];
  const t: (T | string)[] = src.slice(0, n);
  if (src.length > n) t.push(`…+${src.length - n} more`);
  return t;
};

export function renderPrComment(r: Report): string {
  const MAX = intEnv("SCHEMA_DRIFT_ANNOTATION_MAX", 10);
  const MISS = intEnv("SCHEMA_DRIFT_MISSING_CAP", 20);
  const TYPE = intEnv("SCHEMA_DRIFT_MISTYPED_CAP", 20);
  const EXTRA = intEnv("SCHEMA_DRIFT_EXTRA_CAP", 20);
  const bad = r.files.filter((f) => !f.ok);
  if (bad.length === 0) {
    return `### schema-drift manifests ✅\n\nAll ${r.totals.checked} manifest(s) passed strict validation.\n`;
  }
  const lines: string[] = [];
  lines.push(
    `### schema-drift manifests ❌ ${r.totals.invalid}/${r.totals.checked} invalid (strict=${r.strict})`,
  );
  lines.push("", "| Manifest | Scope | Issues |", "|---|---|---|");
  for (const f of bad.slice(0, MAX)) {
    const label = f.combined ? "combined" : `browser=\`${f.browser ?? "?"}\``;
    const parts: string[] = [];
    if (f.parseError) parts.push(`parseError: \`${f.parseError}\``);
    if (f.missing?.length)
      parts.push(`missing: \`${cap(f.missing, MISS).join(", ")}\``);
    if (f.mistyped?.length)
      parts.push(
        `mistyped: \`${cap(
          f.mistyped.map((m) => `${m.key}(want ${m.expected}, got ${m.got})`),
          TYPE,
        ).join(", ")}\``,
      );
    if (f.extra?.length)
      parts.push(`extra: \`${cap(f.extra, EXTRA).join(", ")}\``);
    lines.push(`| \`${f.path}\` | ${label} | ${parts.join("<br>")} |`);
  }
  if (bad.length > MAX)
    lines.push(
      `\n_${bad.length - MAX} additional failure(s) elided — see the uploaded \`schema-drift-fixture-validation\` artifact._`,
    );
  return lines.join("\n") + "\n";
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.error(
      "Usage: bun scripts/schema-drift-pr-comment.ts <report.json> [--out <path>]",
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  let reportPath = "";
  let outPath = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") outPath = args[++i] ?? "";
    else if (a.startsWith("--out=")) outPath = a.slice("--out=".length);
    else if (!reportPath) reportPath = a;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  const r: Report = JSON.parse(readFileSync(reportPath, "utf8"));
  const body = renderPrComment(r);
  if (outPath) {
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(outPath, body);
    console.error(`pr-comment: ${outPath}`);
  } else {
    process.stdout.write(body);
  }
}

if (import.meta.main) main();
