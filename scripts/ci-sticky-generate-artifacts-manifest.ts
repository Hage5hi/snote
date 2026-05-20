// Generator CLI for `sticky-artifacts-manifest.json`
// (schema: `sticky-artifacts-manifest/v1`).
//
// Scans a local artifacts folder for the two known bundle types —
// `sticky-replay/*.json` and `sticky-fuzz-failures/*.json` — and emits
// a manifest listing each file with its path, basename, byte size and
// a download URL (built from --run-url + a per-entry anchor).
//
// Usage:
//   bun run scripts/ci-sticky-generate-artifacts-manifest.ts \
//     --root reports/_ci --out reports/_ci/sticky-artifacts-manifest.json \
//     [--run-url https://.../actions/runs/123]
//
// Exit codes follow scripts/_helpers/sticky-replay-exit-codes.ts.

import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { validateManifest, formatProblems } from "./_helpers/sticky-replay-schemas";
import {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_IO,
  EXIT_SCHEMA,
  EXIT_CODE_HELP,
} from "./_helpers/sticky-replay-exit-codes";

const BUNDLES = [
  { name: "sticky-replay", subdir: "sticky-replay" },
  { name: "sticky-fuzz-failures", subdir: "sticky-fuzz-failures" },
] as const;

const HELP = `ci-sticky-generate-artifacts-manifest — scan a folder and emit a sticky-artifacts-manifest/v1

USAGE
  bun run scripts/ci-sticky-generate-artifacts-manifest.ts --root <dir> --out <manifest.json> [--run-url <url>] [--pretty]

FLAGS
  --root <dir>     Directory to scan. Looks for ${BUNDLES.map(b => b.subdir + "/*.json").join(" and ")}.
  --out <path>     Where to write the manifest JSON.
  --run-url <url>  Workflow run URL used to build per-entry downloadUrl
                   (default: \$GITHUB_RUN_URL or "" when missing).
  --base <root>    Make manifest entry paths relative to this base
                   directory. Default: parent of --out.
  --bundle <name>  Restrict scan to a single bundle (repeatable). Accepts
                   ${BUNDLES.map(b => `"${b.name}"`).join(" or ")}. Default: all.
  --pretty         Pretty-print the written manifest JSON (default: compact).
  -h, --help       Show this help

${EXIT_CODE_HELP}`;

interface Args {
  root: string | null;
  out: string | null;
  runUrl: string;
  base: string | null;
  bundles: string[];
  pretty: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    root: null, out: null,
    runUrl: process.env.GITHUB_RUN_URL ?? "",
    base: null, bundles: [], pretty: false, help: false,
  };
  const known = new Set(BUNDLES.map((b) => b.name));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--root") out.root = argv[++i] ?? null;
    else if (a === "--out") out.out = argv[++i] ?? null;
    else if (a === "--run-url") out.runUrl = argv[++i] ?? "";
    else if (a === "--base") out.base = argv[++i] ?? null;
    else if (a === "--bundle") {
      const v = argv[++i] ?? "";
      if (!known.has(v)) {
        throw new Error(
          `unknown --bundle value: ${JSON.stringify(v)} (expected one of ${[...known].map((b) => JSON.stringify(b)).join(", ")})`,
        );
      }
      if (!out.bundles.includes(v)) out.bundles.push(v);
    }
    else if (a === "--pretty") out.pretty = true;
    else throw new Error(`unknown flag: ${a}`);
  }
  return out;
}

function listJsonFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".json"))
    .map((n) => join(dir, n))
    .filter((p) => {
      try { return statSync(p).isFile(); } catch { return false; }
    })
    .sort();
}

export async function runGenerateManifest(argv: string[]): Promise<number> {
  let cfg: Args;
  try {
    cfg = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    console.error(HELP);
    return EXIT_USAGE;
  }
  if (cfg.help) { console.log(HELP); return EXIT_OK; }
  if (!cfg.root || !cfg.out) {
    console.error("missing required --root and/or --out");
    console.error(HELP);
    return EXIT_USAGE;
  }
  const rootAbs = resolve(cfg.root);
  const outAbs = resolve(cfg.out);
  const baseAbs = cfg.base ? resolve(cfg.base) : dirname(outAbs);

  const entries: Array<Record<string, unknown>> = [];
  for (const bundle of BUNDLES) {
    const subAbs = join(rootAbs, bundle.subdir);
    const files = listJsonFiles(subAbs);
    for (const abs of files) {
      let st;
      try { st = statSync(abs); }
      catch (e) {
        console.error(`[manifest-gen] cannot stat ${abs}: ${(e as Error).message}`);
        return EXIT_IO;
      }
      const rel = relative(baseAbs, abs) || abs;
      const basename = abs.split(/[/\\]/).pop()!;
      const anchor = `entries-${entries.length}`;
      entries.push({
        bundle: bundle.name,
        path: rel,
        basename,
        sizeBytes: st.size,
        anchor,
        downloadUrl: cfg.runUrl ? `${cfg.runUrl}#${anchor}` : "",
      });
    }
  }

  const manifest = {
    schema: "sticky-artifacts-manifest/v1",
    runUrl: cfg.runUrl,
    generatedAt: new Date().toISOString(),
    root: relative(baseAbs, rootAbs) || ".",
    entries,
  };

  const probs = validateManifest(manifest);
  if (probs.length > 0) {
    console.error(formatProblems("manifest-gen", "<in-memory manifest>", probs));
    return EXIT_SCHEMA;
  }

  try {
    mkdirSync(dirname(outAbs), { recursive: true });
    const body = cfg.pretty ? JSON.stringify(manifest, null, 2) : JSON.stringify(manifest);
    writeFileSync(outAbs, body + "\n", "utf8");
  } catch (e) {
    console.error(`[manifest-gen] failed to write ${outAbs}: ${(e as Error).message}`);
    return EXIT_IO;
  }
  console.log(`[manifest-gen] wrote ${outAbs} (${entries.length} entries)`);
  return EXIT_OK;
}

const isEntrypoint =
  typeof process !== "undefined" &&
  typeof import.meta !== "undefined" &&
  // @ts-expect-error import.meta.main is Bun-specific; falsy elsewhere.
  (import.meta.main === true ||
    (process.argv[1] && process.argv[1].endsWith("ci-sticky-generate-artifacts-manifest.ts")));

if (isEntrypoint) {
  runGenerateManifest(process.argv.slice(2)).then((code) => process.exit(code));
}
