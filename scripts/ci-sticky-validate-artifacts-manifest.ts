// Validator CLI for `reports/_ci/sticky-artifacts-manifest.json`
// (schema: `sticky-artifacts-manifest/v1`).
//
// Confirms:
//   1. The file parses as JSON.
//   2. It passes the strict `sticky-artifacts-manifest/v1` schema.
//   3. Every entry references a file that exists on disk and whose
//      actual size matches `sizeBytes`. Entries may declare either a
//      literal `path` + `basename` OR a glob `pattern`. Glob entries
//      MUST resolve to exactly one file whose size matches `sizeBytes`.
//
// Used as a CI gate so a broken manifest never reaches PR bots /
// dashboards / the replay annotations that link into it.
//
// Usage:
//   bun run scripts/ci-sticky-validate-artifacts-manifest.ts <path>
//   bun run scripts/ci-sticky-validate-artifacts-manifest.ts <path> --base <root>
//   bun run scripts/ci-sticky-validate-artifacts-manifest.ts <path> --json-summary <out.json>
//
// `--base <root>` resolves relative entry paths against <root>
// (defaults to the manifest file's parent directory's parent — i.e.
// repo root when the manifest is in reports/_ci/).
//
// `--json-summary <out.json>` writes a structured machine-readable
// result file (schema: `sticky-validate-summary/v1`) with counts plus
// per-entry failure reasons so CI can consume a single bundle.

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve, dirname } from "node:path";
import {
  validateManifest,
  validateValidateSummary,
  formatProblems,
} from "./_helpers/sticky-replay-schemas";
import { resolveManifestGlob } from "./_helpers/sticky-manifest-glob";
import {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_IO,
  EXIT_PARSE,
  EXIT_SCHEMA,
  EXIT_OTHER,
  EXIT_CODE_HELP,
} from "./_helpers/sticky-replay-exit-codes";

const HELP = `ci-sticky-validate-artifacts-manifest — validate a sticky-artifacts-manifest/v1 file

USAGE
  bun run scripts/ci-sticky-validate-artifacts-manifest.ts <manifest.json> [--base <root>] [--json-summary <out.json>]

FLAGS
  --base <root>            Resolve relative entry paths against <root>.
                           Default: the manifest's grandparent directory.
  --json-summary <path>    Write a sticky-validate-summary/v1 JSON file
                           with counts and per-entry failure reasons.
  -h, --help               Show this help

${EXIT_CODE_HELP}`;

interface Args {
  path: string | null;
  base: string | null;
  jsonSummary: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { path: null, base: null, jsonSummary: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--base") out.base = argv[++i] ?? null;
    else if (a === "--json-summary") out.jsonSummary = argv[++i] ?? null;
    else if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    else if (out.path === null) out.path = a;
    else throw new Error(`unexpected positional: ${a}`);
  }
  return out;
}

interface EntrySummary {
  index: number;
  bundle: string;
  pattern?: string;
  path?: string;
  resolvedPath?: string;
  resolvedMatches?: number;
  ok: boolean;
  problems: string[];
}

function writeSummary(
  path: string,
  payload: {
    schema: string;
    target: string;
    ok: boolean;
    exitCode: number;
    schemaProblems: string[];
    entryFailureCount: number;
    entries: EntrySummary[];
  },
) {
  try {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  } catch (e) {
    console.error(`[manifest] WARN: failed to write --json-summary ${path}: ${(e as Error).message}`);
  }
}

export async function runValidateManifest(argv: string[]): Promise<number> {
  let cfg: Args;
  try {
    cfg = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    console.error(HELP);
    return EXIT_USAGE;
  }
  if (cfg.help) { console.log(HELP); return EXIT_OK; }
  if (!cfg.path) {
    console.error("missing manifest path");
    console.error(HELP);
    return EXIT_USAGE;
  }

  let raw: string;
  try { raw = readFileSync(cfg.path, "utf8"); }
  catch (e) {
    console.error(`[manifest] cannot read ${cfg.path}: ${(e as Error).message}`);
    if (cfg.jsonSummary) writeSummary(cfg.jsonSummary, {
      schema: "sticky-validate-summary/v1", target: cfg.path, ok: false,
      exitCode: EXIT_IO, schemaProblems: [`cannot read ${cfg.path}`],
      entryFailureCount: 0, entries: [],
    });
    return EXIT_IO;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    console.error(`[manifest] ${cfg.path} is not valid JSON: ${(e as Error).message}`);
    if (cfg.jsonSummary) writeSummary(cfg.jsonSummary, {
      schema: "sticky-validate-summary/v1", target: cfg.path, ok: false,
      exitCode: EXIT_PARSE, schemaProblems: [`not valid JSON: ${(e as Error).message}`],
      entryFailureCount: 0, entries: [],
    });
    return EXIT_PARSE;
  }
  const probs = validateManifest(parsed);
  if (probs.length > 0) {
    console.error(formatProblems("manifest", cfg.path, probs));
    if (cfg.jsonSummary) writeSummary(cfg.jsonSummary, {
      schema: "sticky-validate-summary/v1", target: cfg.path, ok: false,
      exitCode: EXIT_SCHEMA, schemaProblems: probs, entryFailureCount: 0, entries: [],
    });
    return EXIT_SCHEMA;
  }

  const manifest = parsed as {
    entries: Array<{
      bundle: string; path?: string; basename?: string;
      sizeBytes: number; pattern?: string;
    }>;
  };
  const baseRoot = cfg.base ?? dirname(dirname(resolve(cfg.path)));
  const entrySummaries: EntrySummary[] = [];
  const fileProblems: string[] = [];

  for (let i = 0; i < manifest.entries.length; i++) {
    const e = manifest.entries[i];
    const summary: EntrySummary = { index: i, bundle: e.bundle, ok: true, problems: [] };
    if (typeof e.pattern === "string") {
      summary.pattern = e.pattern;
      let matches: string[];
      try { matches = resolveManifestGlob(e.pattern, baseRoot); }
      catch (err) {
        summary.ok = false;
        summary.problems.push((err as Error).message);
        fileProblems.push(`entries[${i}] (pattern=${e.pattern}): ${(err as Error).message}`);
        entrySummaries.push(summary);
        continue;
      }
      summary.resolvedMatches = matches.length;
      if (matches.length !== 1) {
        summary.ok = false;
        const msg = `pattern "${e.pattern}" resolved to ${matches.length} files (expected exactly 1)${matches.length > 0 ? `: ${matches.join(", ")}` : ""}`;
        summary.problems.push(msg);
        fileProblems.push(`entries[${i}] (bundle=${e.bundle}): ${msg}`);
        entrySummaries.push(summary);
        continue;
      }
      const abs = matches[0];
      summary.resolvedPath = abs;
      const st = statSync(abs);
      if (st.size !== e.sizeBytes) {
        summary.ok = false;
        const msg = `size mismatch — manifest declares ${e.sizeBytes}B, actual ${st.size}B at ${abs}`;
        summary.problems.push(msg);
        fileProblems.push(`entries[${i}] (bundle=${e.bundle}, pattern=${e.pattern}): ${msg}`);
      }
      entrySummaries.push(summary);
      continue;
    }

    // Literal path entry.
    summary.path = e.path;
    const abs = isAbsolute(e.path!) ? e.path! : resolve(baseRoot, e.path!);
    summary.resolvedPath = abs;
    let st: ReturnType<typeof statSync>;
    try { st = statSync(abs); }
    catch (err) {
      summary.ok = false;
      const msg = `file not found at ${abs} (${(err as Error).message})`;
      summary.problems.push(msg);
      fileProblems.push(`entries[${i}] (bundle=${e.bundle}, basename=${e.basename}): ${msg}`);
      entrySummaries.push(summary);
      continue;
    }
    if (!st.isFile()) {
      summary.ok = false;
      const msg = `${abs} is not a regular file`;
      summary.problems.push(msg);
      fileProblems.push(`entries[${i}] (bundle=${e.bundle}, basename=${e.basename}): ${msg}`);
      entrySummaries.push(summary);
      continue;
    }
    if (st.size !== e.sizeBytes) {
      summary.ok = false;
      const msg = `size mismatch — manifest declares ${e.sizeBytes}B, actual ${st.size}B at ${abs}`;
      summary.problems.push(msg);
      fileProblems.push(`entries[${i}] (bundle=${e.bundle}, basename=${e.basename}): ${msg}`);
    }
    const tail = e.path!.split(/[/\\]/).pop();
    if (tail !== e.basename) {
      summary.ok = false;
      const msg = `basename "${e.basename}" does not match path tail "${tail}" (path=${e.path})`;
      summary.problems.push(msg);
      fileProblems.push(`entries[${i}]: ${msg}`);
    }
    entrySummaries.push(summary);
  }

  if (fileProblems.length > 0) {
    console.error(
      `[manifest] ${cfg.path}: ${fileProblems.length} file integrity problem${fileProblems.length === 1 ? "" : "s"}:`,
    );
    for (const p of fileProblems) console.error(`  - ${p}`);
    if (cfg.jsonSummary) writeSummary(cfg.jsonSummary, {
      schema: "sticky-validate-summary/v1", target: cfg.path, ok: false,
      exitCode: EXIT_OTHER, schemaProblems: [],
      entryFailureCount: entrySummaries.filter((e) => !e.ok).length,
      entries: entrySummaries,
    });
    return EXIT_OTHER;
  }
  console.log(
    `[manifest] OK: ${cfg.path} (${manifest.entries.length} entries, all files present and sizes match)`,
  );
  if (cfg.jsonSummary) writeSummary(cfg.jsonSummary, {
    schema: "sticky-validate-summary/v1", target: cfg.path, ok: true,
    exitCode: EXIT_OK, schemaProblems: [], entryFailureCount: 0,
    entries: entrySummaries,
  });
  return EXIT_OK;
}

const isEntrypoint =
  typeof process !== "undefined" &&
  typeof import.meta !== "undefined" &&
  // @ts-expect-error import.meta.main is Bun-specific; falsy elsewhere.
  (import.meta.main === true ||
    (process.argv[1] && process.argv[1].endsWith("ci-sticky-validate-artifacts-manifest.ts")));

if (isEntrypoint) {
  runValidateManifest(process.argv.slice(2)).then((code) => process.exit(code));
}
