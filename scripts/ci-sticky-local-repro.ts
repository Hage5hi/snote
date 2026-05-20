// One-command local repro for a sticky fuzz failure.
//
// Takes a `sticky-fuzz-failure/v1` artifact path and runs BOTH:
//
//   1. The matcher replay (re-executes hasStickyMarker head-scan +
//      full-scan paths against the captured body/marker).
//   2. The newest-wins pagination-overlap replay (drives the real
//      upsertStickyComment against the canned overlapping pages).
//
// Both runs share the same output directory so the resulting JSON
// artifacts land next to each other and are easy to diff.
//
// Usage:
//   bun run scripts/ci-sticky-local-repro.ts <artifact.json>
//   bun run scripts/ci-sticky-local-repro.ts <artifact.json> \
//     --out-dir reports/_ci/local-repro \
//     --scenario overlap-dup-page \
//     --head-scan-lines 5
//
// Exit codes:
//   0  both replays ran (regardless of their findings)
//   1  bad flags / fuzz replay failed schema validation
//   2  overlap replay errored

import { basename, join } from "node:path";
import { mkdirSync } from "node:fs";
import { runFuzzReplay } from "./ci-sticky-fuzz-failure-replay";
import { runReplay as runOverlapReplay } from "./ci-sticky-newest-wins-overlap-replay";

const HELP = `ci-sticky-local-repro — one-command repro for a sticky fuzz failure

USAGE
  bun run scripts/ci-sticky-local-repro.ts <artifact.json> [flags]

FLAGS
  --out-dir <dir>           Write both replay JSONs into <dir>.
                            Default: reports/_ci/local-repro
  --scenario <name>         Overlap scenario (default: overlap-dup-page)
  --head-scan-lines <n>     headScanLines for overlap replay (default 5)
  --strategy <s>            Cleanup strategy for overlap replay
  -h, --help                Show this help
`;

interface Cfg {
  artifact: string | null;
  outDir: string;
  scenario: string;
  headScanLines: string;
  strategy: string;
  help: boolean;
}

function parseArgs(argv: string[]): Cfg {
  const cfg: Cfg = {
    artifact: null,
    outDir: "reports/_ci/local-repro",
    scenario: "overlap-dup-page",
    headScanLines: "5",
    strategy: "delete",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => argv[++i];
    if (a === "-h" || a === "--help") cfg.help = true;
    else if (a === "--out-dir") cfg.outDir = take();
    else if (a === "--scenario") cfg.scenario = take();
    else if (a === "--head-scan-lines") cfg.headScanLines = take();
    else if (a === "--strategy") cfg.strategy = take();
    else if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    else if (cfg.artifact === null) cfg.artifact = a;
    else throw new Error(`unexpected positional: ${a}`);
  }
  return cfg;
}

export async function runLocalRepro(argv: string[]): Promise<number> {
  let cfg: Cfg;
  try {
    cfg = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    console.error(HELP);
    return 1;
  }
  if (cfg.help) {
    console.log(HELP);
    return 0;
  }
  if (!cfg.artifact) {
    console.error("missing artifact path");
    console.error(HELP);
    return 1;
  }

  mkdirSync(cfg.outDir, { recursive: true });
  const base = basename(cfg.artifact).replace(/\.json$/i, "");
  const fuzzOut = join(cfg.outDir, `${base}.matcher-replay.json`);
  const overlapOut = join(cfg.outDir, `${base}.overlap-replay.json`);

  console.log(`[local-repro] artifact=${cfg.artifact}`);
  console.log(`[local-repro] out-dir=${cfg.outDir}`);
  console.log(`[local-repro] step 1/2 — matcher replay`);
  const fuzzCode = await runFuzzReplay([cfg.artifact, "--json", fuzzOut]);
  if (fuzzCode !== 0) {
    console.error(`[local-repro] matcher replay failed with exit=${fuzzCode}`);
    return 1;
  }

  console.log(`[local-repro] step 2/2 — overlap replay (scenario=${cfg.scenario})`);
  const overlapCode = await runOverlapReplay([
    "--scenario",
    cfg.scenario,
    "--head-scan-lines",
    cfg.headScanLines,
    "--strategy",
    cfg.strategy,
    "--json",
    overlapOut,
  ]);
  if (overlapCode !== 0) {
    console.error(`[local-repro] overlap replay failed with exit=${overlapCode}`);
    return 2;
  }

  console.log(`[local-repro] done`);
  console.log(`[local-repro]   matcher json=${fuzzOut}`);
  console.log(`[local-repro]   overlap json=${overlapOut}`);
  return 0;
}

const isEntrypoint =
  typeof process !== "undefined" &&
  typeof import.meta !== "undefined" &&
  // @ts-expect-error import.meta.main is Bun-specific; falsy elsewhere.
  (import.meta.main === true ||
    (process.argv[1] && process.argv[1].endsWith("ci-sticky-local-repro.ts")));

if (isEntrypoint) {
  runLocalRepro(process.argv.slice(2)).then((code) => process.exit(code));
}
