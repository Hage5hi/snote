// Validator CLI for `reports/_ci/sticky-artifacts-manifest.json`
// (schema: `sticky-artifacts-manifest/v1`).
//
// Confirms:
//   1. The file parses as JSON.
//   2. It passes the strict `sticky-artifacts-manifest/v1` schema.
//   3. Every entry in `.entries[]` references a file that exists on
//      disk and whose actual size matches `sizeBytes`.
//
// Used as a CI gate so a broken manifest never reaches PR bots /
// dashboards / the replay annotations that link into it.
//
// Usage:
//   bun run scripts/ci-sticky-validate-artifacts-manifest.ts <path>
//   bun run scripts/ci-sticky-validate-artifacts-manifest.ts <path> --base <root>
//
// `--base <root>` resolves relative entry paths against <root>
// (defaults to the manifest file's parent directory's parent — i.e.
// repo root when the manifest is in reports/_ci/).

import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve, dirname } from "node:path";
import { validateManifest, formatProblems } from "./_helpers/sticky-replay-schemas";
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
  bun run scripts/ci-sticky-validate-artifacts-manifest.ts <manifest.json> [--base <root>]

FLAGS
  --base <root>   Resolve relative entry paths against <root>. Default:
                  the manifest's grandparent directory (so a manifest at
                  reports/_ci/sticky-artifacts-manifest.json resolves
                  paths against the repo root).
  -h, --help      Show this help

${EXIT_CODE_HELP}`;

interface Args {
  path: string | null;
  base: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { path: null, base: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--base") out.base = argv[++i] ?? null;
    else if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    else if (out.path === null) out.path = a;
    else throw new Error(`unexpected positional: ${a}`);
  }
  return out;
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
  if (cfg.help) {
    console.log(HELP);
    return EXIT_OK;
  }
  if (!cfg.path) {
    console.error("missing manifest path");
    console.error(HELP);
    return EXIT_USAGE;
  }

  let raw: string;
  try {
    raw = readFileSync(cfg.path, "utf8");
  } catch (e) {
    console.error(
      `[manifest] cannot read ${cfg.path}: ${(e as Error).message}`,
    );
    return EXIT_IO;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(
      `[manifest] ${cfg.path} is not valid JSON: ${(e as Error).message}`,
    );
    return EXIT_PARSE;
  }
  const probs = validateManifest(parsed);
  if (probs.length > 0) {
    console.error(formatProblems("manifest", cfg.path, probs));
    return EXIT_SCHEMA;
  }

  // After schema passes we know the shape; assert each referenced file
  // actually exists with the declared size.
  const manifest = parsed as {
    entries: Array<{ bundle: string; path: string; basename: string; sizeBytes: number }>;
  };
  const baseRoot = cfg.base ?? dirname(dirname(resolve(cfg.path)));
  const fileProblems: string[] = [];
  for (let i = 0; i < manifest.entries.length; i++) {
    const e = manifest.entries[i];
    const abs = isAbsolute(e.path) ? e.path : resolve(baseRoot, e.path);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch (err) {
      fileProblems.push(
        `entries[${i}] (bundle=${e.bundle}, basename=${e.basename}): file not found at ${abs} (${(err as Error).message})`,
      );
      continue;
    }
    if (!st.isFile()) {
      fileProblems.push(
        `entries[${i}] (bundle=${e.bundle}, basename=${e.basename}): ${abs} is not a regular file`,
      );
      continue;
    }
    if (st.size !== e.sizeBytes) {
      fileProblems.push(
        `entries[${i}] (bundle=${e.bundle}, basename=${e.basename}): size mismatch — manifest declares ${e.sizeBytes}B, actual ${st.size}B at ${abs}`,
      );
    }
    // Defensive: basename in the manifest must match the path's tail.
    const tail = e.path.split(/[/\\]/).pop();
    if (tail !== e.basename) {
      fileProblems.push(
        `entries[${i}]: basename "${e.basename}" does not match path tail "${tail}" (path=${e.path})`,
      );
    }
  }
  if (fileProblems.length > 0) {
    console.error(
      `[manifest] ${cfg.path}: ${fileProblems.length} file integrity problem${fileProblems.length === 1 ? "" : "s"}:`,
    );
    for (const p of fileProblems) console.error(`  - ${p}`);
    return EXIT_OTHER;
  }
  console.log(
    `[manifest] OK: ${cfg.path} (${manifest.entries.length} entries, all files present and sizes match)`,
  );
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
