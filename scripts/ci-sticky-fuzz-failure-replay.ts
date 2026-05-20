// Replay CLI for a `sticky-fuzz-failure/v1` artifact.
//
// Given a JSON file produced by `runFuzzWithSeed` (under
// `reports/_ci/sticky-fuzz-failures/` by default), re-runs the exact
// marker matcher paths on the captured body + marker literal and
// prints the matcher results plus the cleanedIds the artifact
// recorded. This is the one-shot local repro path — no fuzzing loop,
// no PRNG, just the exact inputs that broke.
//
// Usage:
//   bun run scripts/ci-sticky-fuzz-failure-replay.ts <artifact.json>
//   bun run scripts/ci-sticky-fuzz-failure-replay.ts --file <path>
//   bun run scripts/ci-sticky-fuzz-failure-replay.ts --help
//
// Exit codes:
//   0  ran successfully (regardless of matcher outcome)
//   1  bad flags / missing/invalid artifact

import { readFileSync } from "node:fs";
import { hasStickyMarker } from "./ci-sticky-pr-comment-upsert";

interface FuzzArtifactInputs {
  markerLiteral?: string;
  markerVariant?: string;
  partial?: string;
  body?: string;
  paths?: {
    headScan?: { returned?: unknown; threw?: string | null };
    fullScan?: { returned?: unknown; threw?: string | null };
  };
  cleanedIds?: unknown;
}

interface FuzzArtifact {
  schema?: string;
  name?: string;
  seed?: number;
  iteration?: number;
  error?: string;
  reproduce?: string;
  inputs?: FuzzArtifactInputs | null;
}

const HELP = `ci-sticky-fuzz-failure-replay — re-run a fuzz failure artifact

USAGE
  bun run scripts/ci-sticky-fuzz-failure-replay.ts <artifact.json>
  bun run scripts/ci-sticky-fuzz-failure-replay.ts --file <path>

The artifact must carry the sticky-fuzz-failure/v1 schema and contain
inputs.markerLiteral + inputs.body. The CLI re-runs hasStickyMarker on
both head-scan and full-scan paths and prints the matcher results
alongside the cleanedIds the artifact captured at failure time.
`;

function parseArgs(argv: string[]): { path: string | null; help: boolean } {
  const out = { path: null as string | null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--file") out.path = argv[++i] ?? null;
    else if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    else if (out.path === null) out.path = a;
    else throw new Error(`unexpected positional: ${a}`);
  }
  return out;
}

function runMatcher(body: string, marker: string, fullScan: boolean) {
  try {
    return { returned: hasStickyMarker(body, marker, { fullScan }), threw: null as string | null };
  } catch (e) {
    return { returned: null, threw: (e as Error).message };
  }
}

export async function runFuzzReplay(argv: string[]): Promise<number> {
  let cfg;
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
  if (!cfg.path) {
    console.error("missing artifact path");
    console.error(HELP);
    return 1;
  }

  let artifact: FuzzArtifact;
  try {
    artifact = JSON.parse(readFileSync(cfg.path, "utf8")) as FuzzArtifact;
  } catch (e) {
    console.error(`[fuzz-replay] failed to read ${cfg.path}: ${(e as Error).message}`);
    return 1;
  }
  if (artifact.schema !== "sticky-fuzz-failure/v1") {
    console.error(
      `[fuzz-replay] unexpected schema=${String(artifact.schema)} ` +
        `(expected sticky-fuzz-failure/v1)`,
    );
    return 1;
  }
  const inputs = artifact.inputs ?? {};
  const marker = inputs.markerLiteral;
  const body = inputs.body;
  if (typeof marker !== "string" || typeof body !== "string") {
    console.error(
      `[fuzz-replay] artifact missing inputs.markerLiteral or inputs.body — ` +
        `cannot re-run matcher paths (this is normal for matcher-only ` +
        `fuzz tests that did not capture the body; nothing to replay).`,
    );
    return 1;
  }

  const head = runMatcher(body, marker, false);
  const full = runMatcher(body, marker, true);

  const out = {
    schema: "sticky-fuzz-replay/v1",
    source: cfg.path,
    artifact: {
      name: artifact.name,
      seed: artifact.seed,
      iteration: artifact.iteration,
      error: artifact.error,
      reproduce: artifact.reproduce,
    },
    inputs: {
      markerLiteral: marker,
      markerVariant: inputs.markerVariant ?? null,
      partial: inputs.partial ?? null,
      bodyLength: body.length,
    },
    matcher: { headScan: head, fullScan: full },
    capturedAtFailure: {
      paths: inputs.paths ?? null,
      cleanedIds: inputs.cleanedIds ?? null,
    },
  };
  console.log(JSON.stringify(out, null, 2));
  return 0;
}

const isEntrypoint =
  typeof process !== "undefined" &&
  typeof import.meta !== "undefined" &&
  // @ts-expect-error import.meta.main is Bun-specific; falsy elsewhere.
  (import.meta.main === true ||
    (process.argv[1] && process.argv[1].endsWith("ci-sticky-fuzz-failure-replay.ts")));

if (isEntrypoint) {
  runFuzzReplay(process.argv.slice(2)).then((code) => process.exit(code));
}
