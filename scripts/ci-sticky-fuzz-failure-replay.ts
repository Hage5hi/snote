// Replay CLI for a `sticky-fuzz-failure/v1` artifact.
//
// Given a JSON file produced by `runFuzzWithSeed` (under
// `reports/_ci/sticky-fuzz-failures/` by default), re-runs the exact
// marker matcher paths on the captured body + marker literal and
// prints the matcher results plus the cleanedIds the artifact
// recorded.
//
// Usage:
//   bun run scripts/ci-sticky-fuzz-failure-replay.ts <artifact.json>
//   bun run scripts/ci-sticky-fuzz-failure-replay.ts --file <path>
//   bun run scripts/ci-sticky-fuzz-failure-replay.ts <a.json> --json <out.json>
//
// Schema validation: artifacts MUST be sticky-fuzz-failure/v1 and
// carry inputs.markerLiteral + inputs.body. Missing required fields
// produce a single clear error listing every problem (not a vague
// "cannot replay"), so partial captures can be fixed at the source.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hasStickyMarker } from "./ci-sticky-pr-comment-upsert";
import {
  validateFuzzReplayResult,
  formatProblems,
  filterProblemsByPath,
  isAcceptedSchema,
  ACCEPTED_FUZZ_FAILURE_SCHEMAS,
} from "./_helpers/sticky-replay-schemas";
import {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_IO,
  EXIT_PARSE,
  EXIT_SCHEMA,
  EXIT_CODE_HELP,
} from "./_helpers/sticky-replay-exit-codes";


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
  bun run scripts/ci-sticky-fuzz-failure-replay.ts <artifact.json> [flags]

FLAGS
  --file <path>         Read the artifact from <path>
  --json <path>         Also write the machine-readable replay result to <path>
  --pretty              Indent the written JSON output for readability.
                        Default: compact single-line JSON (smaller diffs).
                        Combine with --json — the written file remains
                        valid JSON matching the sticky-fuzz-replay/v1
                        schema in either compact or pretty form.
  --validate-only <p>   Validate an existing sticky-fuzz-replay/v1 JSON
                        file at <p> against the strict schema and exit.
                        No matcher is re-run and no file is written.
  --fields <prefixes>   With --validate-only, restrict reported problems
                        to JSON paths starting with one of the given
                        comma-separated prefixes (e.g. "inputs,matcher").
                        Schema-mismatch errors are always reported so a
                        wrong document never passes silently.
  -h, --help            Show this help

${EXIT_CODE_HELP}
The artifact must carry a sticky-fuzz-failure/v1-compatible schema
(${ACCEPTED_FUZZ_FAILURE_SCHEMAS.join(", ")} or future v1.x minor
revisions) and contain inputs.markerLiteral + inputs.body. The CLI
re-runs hasStickyMarker on both head-scan and full-scan paths and
prints the matcher results alongside the cleanedIds the artifact
captured at failure time.
`;

function parseArgs(argv: string[]): {
  path: string | null;
  json: string | null;
  pretty: boolean;
  validateOnly: string | null;
  fields: string[];
  help: boolean;
} {
  const out = {
    path: null as string | null,
    json: null as string | null,
    pretty: false,
    validateOnly: null as string | null,
    fields: [] as string[],
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--file") out.path = argv[++i] ?? null;
    else if (a === "--json") out.json = argv[++i] ?? null;
    else if (a === "--pretty") out.pretty = true;
    else if (a === "--validate-only") out.validateOnly = argv[++i] ?? null;
    else if (a === "--fields") {
      const v = argv[++i] ?? "";
      out.fields = v.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    else if (out.path === null) out.path = a;
    else throw new Error(`unexpected positional: ${a}`);
  }
  return out;
}


function runMatcher(body: string, marker: string, fullScan: boolean) {
  try {
    return {
      returned: hasStickyMarker(body, marker, { fullScan }),
      threw: null as string | null,
    };
  } catch (e) {
    return { returned: null, threw: (e as Error).message };
  }
}

/**
 * Strict schema check. Returns the list of problems (empty = valid).
 * Each problem is human-readable and names the offending field so the
 * caller can produce a single consolidated error message.
 */
export function validateFuzzArtifact(a: unknown): string[] {
  const problems: string[] = [];
  if (!a || typeof a !== "object") {
    return ["artifact root is not a JSON object"];
  }
  const art = a as FuzzArtifact;
  if (!isAcceptedSchema(art.schema, ACCEPTED_FUZZ_FAILURE_SCHEMAS)) {
    problems.push(
      `schema=${JSON.stringify(art.schema)} (expected one of ${JSON.stringify(ACCEPTED_FUZZ_FAILURE_SCHEMAS)})`,
    );
  }
  if (typeof art.seed !== "number") {
    problems.push("seed is missing or not a number");
  }
  if (typeof art.iteration !== "number") {
    problems.push("iteration is missing or not a number");
  }
  const inputs = art.inputs;
  if (!inputs || typeof inputs !== "object") {
    problems.push("inputs is missing or not an object");
    return problems;
  }
  if (typeof inputs.markerLiteral !== "string") {
    problems.push("inputs.markerLiteral is missing or not a string");
  }
  if (typeof inputs.body !== "string") {
    problems.push(
      "inputs.body is missing or not a string — without the original " +
        "comment body the matcher paths cannot be re-executed; capture " +
        "inputs.body when emitting the fuzz failure artifact",
    );
  }
  return problems;
}

export async function runFuzzReplay(argv: string[]): Promise<number> {
  let cfg;
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

  // --validate-only short-circuits everything: load the file, run
  // validateFuzzReplayResult on it, print a clear pass/fail message,
  // and exit. No matcher re-run, no file write.
  if (cfg.validateOnly) {
    let raw: string;
    try {
      raw = readFileSync(cfg.validateOnly, "utf8");
    } catch (e) {
      console.error(
        `[fuzz-replay] --validate-only: cannot read ${cfg.validateOnly}: ${(e as Error).message}`,
      );
      return EXIT_IO;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      console.error(
        `[fuzz-replay] --validate-only: ${cfg.validateOnly} is not valid JSON: ${(e as Error).message}`,
      );
      return EXIT_PARSE;
    }
    let probs = validateFuzzReplayResult(payload);
    if (cfg.fields.length > 0) {
      probs = filterProblemsByPath(probs, cfg.fields);
      console.log(`[fuzz-replay] --fields filter: ${cfg.fields.join(",")}`);
    }
    if (probs.length > 0) {
      console.error(formatProblems("fuzz-replay", cfg.validateOnly, probs));
      return EXIT_SCHEMA;
    }
    console.log(
      `[fuzz-replay] --validate-only OK: ${cfg.validateOnly} matches sticky-fuzz-replay/v1` +
        (cfg.fields.length > 0 ? ` (scoped to: ${cfg.fields.join(",")})` : ""),
    );
    return EXIT_OK;
  }

  if (!cfg.path) {
    console.error("missing artifact path");
    console.error(HELP);
    return EXIT_USAGE;
  }

  let raw: string;
  try {
    raw = readFileSync(cfg.path, "utf8");
  } catch (e) {
    console.error(`[fuzz-replay] failed to read ${cfg.path}: ${(e as Error).message}`);
    return EXIT_IO;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`[fuzz-replay] ${cfg.path} is not valid JSON: ${(e as Error).message}`);
    return EXIT_PARSE;
  }

  const problems = validateFuzzArtifact(parsed);
  if (problems.length > 0) {
    console.error(
      `[fuzz-replay] artifact ${cfg.path} failed sticky-fuzz-failure/v1 ` +
        `schema validation (${problems.length} problem${problems.length === 1 ? "" : "s"}):`,
    );
    for (const p of problems) console.error(`  - ${p}`);
    return EXIT_SCHEMA;
  }

  const artifact = parsed as FuzzArtifact;
  const inputs = artifact.inputs!;
  const marker = inputs.markerLiteral as string;
  const body = inputs.body as string;

  const head = runMatcher(body, marker, false);
  const full = runMatcher(body, marker, true);

  const result = {
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
    timestamp: new Date().toISOString(),
  };
  const stdoutPayload = JSON.stringify(result, null, 2);
  console.log(stdoutPayload);

  const validationProblems = validateFuzzReplayResult(result);
  if (validationProblems.length > 0) {
    console.error(
      formatProblems("fuzz-replay", "<in-memory result>", validationProblems),
    );
    return EXIT_SCHEMA;
  }

  if (cfg.json) {
    try {
      mkdirSync(dirname(cfg.json), { recursive: true });
      const filePayload = cfg.pretty
        ? JSON.stringify(result, null, 2)
        : JSON.stringify(result);
      writeFileSync(cfg.json, filePayload + "\n", "utf8");
      console.log(`[fuzz-replay] wrote json=${cfg.json}`);
    } catch (e) {
      console.error(
        `[fuzz-replay] WARN: failed to write ${cfg.json}: ${(e as Error).message}`,
      );
    }
  }
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
