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
 *   bun scripts/schema-drift-pr-comment.ts <report.json> [flags] [--out <path>]
 *
 * Flags:
 *   --browser <name>       Only include failures for this Playwright project.
 *   --path <substr>        Only include failures whose `path` contains substr.
 *   --kind <k>             missing | mistyped | extra | parseError (repeatable).
 *   --max <n>              Cap the number of failure rows rendered.
 *   --missing-cap <n>      Cap items shown in the "missing" list per row.
 *   --mistyped-cap <n>     Cap items shown in the "mistyped" list per row.
 *   --extra-cap <n>        Cap items shown in the "extra" list per row.
 *   --out <path>           Write to <path> instead of stdout.
 *
 * Env (used as defaults when the matching flag is not passed):
 *   SCHEMA_DRIFT_ANNOTATION_MAX  (default 10)
 *   SCHEMA_DRIFT_MISSING_CAP     (default 20)
 *   SCHEMA_DRIFT_MISTYPED_CAP    (default 20)
 *   SCHEMA_DRIFT_EXTRA_CAP       (default 20)
 *
 * Determinism: failures are always sorted by (path ASC, browser ASC) BEFORE
 * truncation, so the same top-N appear in job summary AND pr-comment.md
 * across runs regardless of the input order in validation-report.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type Mistyped = { key: string; expected: string; got: string };
export type FileEntry = {
  path: string;
  ok: boolean;
  browser?: string | null;
  combined?: boolean;
  missing?: string[];
  mistyped?: Mistyped[];
  extra?: string[];
  parseError?: string | null;
};
export type Report = {
  strict: boolean;
  totals: { checked: number; ok: number; invalid: number };
  files: FileEntry[];
};

export type Kind = "missing" | "mistyped" | "extra" | "parseError";

export type FilterOpts = {
  browser?: string;
  path?: string;
  kind?: Kind | Kind[];
};

export type RenderOpts = FilterOpts & {
  max?: number;
  missingCap?: number;
  mistypedCap?: number;
  extraCap?: number;
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

const hasKind = (f: FileEntry, k: Kind): boolean => {
  if (k === "parseError") return Boolean(f.parseError);
  const v = f[k];
  return Array.isArray(v) && v.length > 0;
};

/**
 * Select failing entries, apply CLI filters, and sort deterministically
 * by (path ASC, browser ASC). Returns a new array — never mutates input.
 */
export function selectFailures(r: Report, opts: FilterOpts = {}): FileEntry[] {
  const kinds: Kind[] | undefined = opts.kind
    ? Array.isArray(opts.kind)
      ? opts.kind
      : [opts.kind]
    : undefined;
  const out = r.files.filter((f) => {
    if (f.ok) return false;
    if (opts.browser && f.browser !== opts.browser) return false;
    if (opts.path && !f.path.includes(opts.path)) return false;
    if (kinds && !kinds.some((k) => hasKind(f, k))) return false;
    return true;
  });
  out.sort((a, b) => {
    const p = a.path.localeCompare(b.path);
    if (p !== 0) return p;
    return (a.browser ?? "").localeCompare(b.browser ?? "");
  });
  return out;
}

/**
 * Stable HTML anchor id for a failure row. Deterministic in (path,
 * browser) — safe to reference from GitHub Actions annotations and from
 * external tools that link into pr-comment.md.
 */
export function anchorFor(f: FileEntry): string {
  const base = (f.path.split("/").pop() ?? f.path).replace(/\.[^.]+$/, "");
  const scope = f.combined ? "combined" : (f.browser ?? "unknown");
  const slug = `${scope}-${base}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `fail-${slug}`;
}

/** Which failure kinds a given entry exhibits, in stable order. */
function kindsOf(f: FileEntry): Kind[] {
  const out: Kind[] = [];
  if (f.parseError) out.push("parseError");
  if (f.missing?.length) out.push("missing");
  if (f.mistyped?.length) out.push("mistyped");
  if (f.extra?.length) out.push("extra");
  return out;
}

export function renderPrComment(r: Report, opts: RenderOpts = {}): string {
  const MAX = opts.max ?? intEnv("SCHEMA_DRIFT_ANNOTATION_MAX", 10);
  const MISS = opts.missingCap ?? intEnv("SCHEMA_DRIFT_MISSING_CAP", 20);
  const TYPE = opts.mistypedCap ?? intEnv("SCHEMA_DRIFT_MISTYPED_CAP", 20);
  const EXTRA = opts.extraCap ?? intEnv("SCHEMA_DRIFT_EXTRA_CAP", 20);
  const bad = selectFailures(r, opts);
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
    const anchor = `<a id="${anchorFor(f)}"></a>`;
    lines.push(`| ${anchor}\`${f.path}\` | ${label} | ${parts.join("<br>")} |`);
  }
  if (bad.length > MAX)
    lines.push(
      `\n_${bad.length - MAX} additional failure(s) elided — see the uploaded \`schema-drift-fixture-validation\` artifact._`,
    );
  return lines.join("\n") + "\n";
}

/**
 * Emit one GitHub Actions `::error::` workflow command per selected
 * failure. When printed to stdout the runner turns each line into an
 * inline annotation; when written to a file the CI job can `cat` it
 * later. Each line references the stable anchor into pr-comment.md so
 * reviewers can jump straight to the failing row.
 */
export function renderAnnotations(
  r: Report,
  opts: RenderOpts & { commentUrl?: string } = {},
): string {
  const bad = selectFailures(r, opts);
  const MAX = opts.max ?? intEnv("SCHEMA_DRIFT_ANNOTATION_MAX", 10);
  const base = opts.commentUrl ?? "";
  const out: string[] = [];
  for (const f of bad.slice(0, MAX)) {
    const kinds = kindsOf(f).join(",") || "unknown";
    const scope = f.combined ? "combined" : `browser=${f.browser ?? "?"}`;
    const href = `${base}#${anchorFor(f)}`;
    out.push(
      `::error file=${f.path},title=schema-drift ${scope}::[kind=${kinds}] ${href}`,
    );
  }
  return out.length ? out.join("\n") + "\n" : "";
}

function parseArgs(argv: string[]): {
  reportPath: string;
  out: string;
  annotationsFile: string;
  commentUrl: string;
  dryRun: boolean;
  opts: RenderOpts;
} {
  const opts: RenderOpts = {};
  let reportPath = "";
  let out = "";
  let annotationsFile = "";
  let commentUrl = "";
  let dryRun = false;
  const kinds: Kind[] = [];
  const need = (i: number, name: string) => {
    const v = argv[i + 1];
    if (v === undefined) {
      console.error(`missing value for ${name}`);
      process.exit(2);
    }
    return v;
  };
  const parseInt10 = (s: string, name: string) => {
    const n = parseInt(s, 10);
    if (!Number.isFinite(n) || n < 0) {
      console.error(`${name} expects a non-negative integer, got: ${s}`);
      process.exit(2);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") { out = need(i, "--out"); i++; }
    else if (a.startsWith("--out=")) out = a.slice(6);
    else if (a === "--annotations-file") { annotationsFile = need(i, "--annotations-file"); i++; }
    else if (a.startsWith("--annotations-file=")) annotationsFile = a.slice(19);
    else if (a === "--comment-url") { commentUrl = need(i, "--comment-url"); i++; }
    else if (a.startsWith("--comment-url=")) commentUrl = a.slice(14);
    else if (a === "--browser") { opts.browser = need(i, "--browser"); i++; }
    else if (a.startsWith("--browser=")) opts.browser = a.slice(10);
    else if (a === "--path") { opts.path = need(i, "--path"); i++; }
    else if (a.startsWith("--path=")) opts.path = a.slice(7);
    else if (a === "--kind") { kinds.push(need(i, "--kind") as Kind); i++; }
    else if (a.startsWith("--kind=")) kinds.push(a.slice(7) as Kind);
    else if (a === "--max") { opts.max = parseInt10(need(i, "--max"), "--max"); i++; }
    else if (a.startsWith("--max=")) opts.max = parseInt10(a.slice(6), "--max");
    else if (a === "--missing-cap") { opts.missingCap = parseInt10(need(i, "--missing-cap"), "--missing-cap"); i++; }
    else if (a === "--mistyped-cap") { opts.mistypedCap = parseInt10(need(i, "--mistyped-cap"), "--mistyped-cap"); i++; }
    else if (a === "--extra-cap") { opts.extraCap = parseInt10(need(i, "--extra-cap"), "--extra-cap"); i++; }
    else if (!reportPath) reportPath = a;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  if (kinds.length) opts.kind = kinds;
  return { reportPath, out, annotationsFile, commentUrl, opts };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.error(
      "Usage: bun scripts/schema-drift-pr-comment.ts <report.json> " +
        "[--browser <name>] [--path <substr>] [--kind missing|mistyped|extra|parseError] " +
        "[--max <n>] [--missing-cap <n>] [--mistyped-cap <n>] [--extra-cap <n>] " +
        "[--out <path>] [--annotations-file <path>] [--comment-url <url>]",
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const { reportPath, out, annotationsFile, commentUrl, opts } = parseArgs(args);
  if (!reportPath) {
    console.error("missing <report.json> positional argument");
    process.exit(2);
  }
  const r: Report = JSON.parse(readFileSync(reportPath, "utf8"));
  const body = renderPrComment(r, opts);
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, body);
    console.error(`pr-comment: ${out}`);
  } else {
    process.stdout.write(body);
  }
  if (annotationsFile) {
    mkdirSync(dirname(resolve(annotationsFile)), { recursive: true });
    writeFileSync(annotationsFile, renderAnnotations(r, { ...opts, commentUrl }));
    console.error(`annotations: ${annotationsFile}`);
  }
}

if (import.meta.main) main();
