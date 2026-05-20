// Replay CLI for the newest-wins-pagination-overlap scenario.
//
// Reruns the SAME stubbed paginated GitHub listing used by
// `scripts/__tests__/ci-sticky-upsert-newest-wins-pagination-overlap.test.ts`
// against the real `upsertStickyComment` implementation and prints the
// `scanStats` + cleanup diagnostics. Useful for:
//
//   • Local repro when the integration test goes red on CI but the
//     timing-based perf tests don't help narrow it down.
//   • Tuning headScanLines / strategy without re-running the full
//     vitest suite.
//
// Usage:
//   bun run scripts/ci-sticky-newest-wins-overlap-replay.ts \
//     [--scenario newest-on-first-page|overlap-dup-page|ts-vs-id|rerun] \
//     [--head-scan-lines 5] [--strategy delete|lock] \
//     [--out <path>] [--no-artifact]
//
// In addition to printing the summary to stdout, the replay writes a
// JSON artifact with the same payload to a configurable path so CI
// jobs (and humans) can attach it for later inspection. Path
// precedence: --out <path>  >  $STICKY_REPLAY_ARTIFACT  >  default
// reports/_ci/sticky-replay/<scenario>.json. Pass --no-artifact to
// suppress the file entirely.
//
// Exits non-zero only on internal errors. The point is diagnostics,
// not assertions — assertions live in the vitest file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  validateOverlapReplayResult,
  formatProblems,
} from "./_helpers/sticky-replay-schemas";




import {
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
  type StickyListMeta,
  type CleanupStrategy,
} from "./ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:newest-wins-overlap -->";

type ScenarioName =
  | "newest-on-first-page"
  | "overlap-dup-page"
  | "ts-vs-id"
  | "rerun";

const SCENARIOS: Record<ScenarioName, StickyComment[][]> = {
  "newest-on-first-page": [
    [
      mk(900, "2026-05-20T10:00:00Z", "ci-newest"),
      mk(300, "2026-05-19T08:00:00Z", "ci-mid"),
    ],
    [mk(200, "2026-05-18T08:00:00Z", "manual-paste")],
    [mk(100, "2026-05-17T08:00:00Z", "ancient")],
  ],
  "overlap-dup-page": [
    [
      mk(900, "2026-05-20T10:00:00Z", "ci-newest"),
      mk(500, "2026-05-19T10:00:00Z", "older-a"),
    ],
    [
      mk(900, "2026-05-20T10:00:00Z", "ci-newest-dup-page"),
      mk(400, "2026-05-18T10:00:00Z", "older-b"),
    ],
  ],
  "ts-vs-id": [
    [
      mk(700, "2026-05-21T23:59:59Z", "edited-old"),
      mk(800, "2026-05-20T10:00:00Z", "real-newest"),
    ],
    [mk(600, "2026-05-19T10:00:00Z", "ancient")],
  ],
  rerun: [
    [mk(900, "2026-05-20T10:00:00Z", "n"), mk(500, "2026-05-19T10:00:00Z", "o1")],
    [mk(900, "2026-05-20T10:00:00Z", "n-dup"), mk(400, "2026-05-18T10:00:00Z", "o2")],
  ],
};

function mk(id: number, isoTs: string, tag: string): StickyComment {
  return { id, body: `${MARKER}\nts=${isoTs} tag=${tag}` };
}

function makeOverlappingApi(pages: StickyComment[][]) {
  const byId = new Map<number, StickyComment>();
  for (const p of pages) for (const c of p) byId.set(c.id, { ...c });
  const api: StickyApi = {
    list: async (): Promise<StickyListMeta> => {
      const comments: StickyComment[] = [];
      for (const page of pages) {
        for (const c of page) {
          const live = byId.get(c.id);
          if (live) comments.push({ id: live.id, body: live.body });
        }
      }
      return { comments, pagesWalked: pages.length };
    },
    create: async (body) => {
      const id = Math.max(0, ...byId.keys()) + 1;
      const c = { id, body };
      byId.set(id, c);
      return c;
    },
    update: async (id, body) => {
      const c = byId.get(id)!;
      c.body = body;
      return { ...c };
    },
    remove: async (id) => {
      byId.delete(id);
    },
  };
  return { api, state: byId };
}

function parseArgs(argv: string[]): {
  scenario: ScenarioName;
  headScanLines: number;
  strategy: CleanupStrategy;
  out: string | null;
  noArtifact: boolean;
  pretty: boolean;
  help: boolean;
} {
  const out = {
    scenario: "overlap-dup-page" as ScenarioName,
    headScanLines: 5,
    strategy: "delete" as CleanupStrategy,
    out: null as string | null,
    noArtifact: false,
    pretty: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => argv[++i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--scenario") out.scenario = take() as ScenarioName;
    else if (a === "--head-scan-lines") out.headScanLines = Number(take());
    else if (a === "--strategy") out.strategy = take() as CleanupStrategy;
    else if (a === "--out" || a === "--json") out.out = take();
    else if (a === "--no-artifact") out.noArtifact = true;
    else if (a === "--pretty") out.pretty = true;
    else if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
  }
  if (!(out.scenario in SCENARIOS)) {
    throw new Error(
      `unknown scenario: ${out.scenario} (one of: ${Object.keys(SCENARIOS).join(", ")})`,
    );
  }
  return out;
}


const HELP = `ci-sticky-newest-wins-overlap-replay — replay the pagination-overlap scenario

USAGE
  bun run scripts/ci-sticky-newest-wins-overlap-replay.ts [flags]

FLAGS
  --scenario <name>         One of: ${Object.keys(SCENARIOS).join(", ")}
                            Default: overlap-dup-page
  --head-scan-lines <n>     Override headScanLines (default 5)
  --strategy <s>            delete | lock (default delete)
  --out, --json <path>      Write the JSON summary to <path>.
                            Overrides $STICKY_REPLAY_ARTIFACT.
  --no-artifact             Skip writing the JSON artifact file.
  -h, --help                Show this help
`;

function resolveArtifactPath(
  scenario: ScenarioName,
  out: string | null,
  noArtifact: boolean,
): string | null {
  if (noArtifact) return null;
  if (out) return out;
  const envPath = process.env.STICKY_REPLAY_ARTIFACT;
  if (envPath && envPath.length > 0) return envPath;
  return `reports/_ci/sticky-replay/${scenario}.json`;
}

function emitGhAnnotation(kind: "notice" | "error", file: string, msg: string) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  // GitHub Actions workflow command — surfaces a clickable annotation
  // in the run summary pointing at the artifact file.
  console.log(`::${kind} file=${file}::${msg}`);
}

export async function runReplay(argv: string[]): Promise<number> {
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
  const pages = SCENARIOS[cfg.scenario];
  const { api, state } = makeOverlappingApi(pages);

  console.log(`[replay] scenario=${cfg.scenario}`);
  console.log(`[replay] pages=${pages.length} initialIds=${[...state.keys()].sort((a, b) => a - b).join(",")}`);
  console.log(
    `[replay] headScanLines=${cfg.headScanLines} strategy=${cfg.strategy}`,
  );

  const res = await upsertStickyComment({
    api,
    marker: MARKER,
    body: "replay body",
    cleanupStrategy: cfg.strategy,
    headScanLines: cfg.headScanLines,
    debug: (l) => console.log(`[replay/sticky-upsert] ${l}`),
  });

  const summary = {
    schema: "sticky-replay/v1",
    scenario: cfg.scenario,
    headScanLines: cfg.headScanLines,
    strategy: cfg.strategy,
    action: res.action,
    selectedId: res.comment.id,
    cleanedIds: res.cleaned.map((c) => c.id),
    usedFullScan: res.usedFullScan,
    scanStats: res.scanStats,
    finalIds: [...state.keys()].sort((a, b) => a - b),
    timestamp: new Date().toISOString(),
  };
  console.log(`[replay] result=${JSON.stringify(summary, null, 2)}`);

  const artifactPath = resolveArtifactPath(cfg.scenario, cfg.out, cfg.noArtifact);
  if (artifactPath) {
    try {
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
      console.log(`[replay] wrote artifact=${artifactPath}`);
      emitGhAnnotation(
        "notice",
        artifactPath,
        `sticky-replay scenario=${cfg.scenario} selectedId=${res.comment.id} ` +
          `cleaned=${res.cleaned.length} usedFullScan=${res.usedFullScan}`,
      );
    } catch (e) {
      console.error(`[replay] WARN: failed to write artifact ${artifactPath}: ${(e as Error).message}`);
    }
  }
  return 0;
}

const isEntrypoint =
  typeof process !== "undefined" &&
  typeof import.meta !== "undefined" &&
  // @ts-expect-error import.meta.main is Bun-specific; falsy elsewhere.
  (import.meta.main === true ||
    (process.argv[1] && process.argv[1].endsWith("ci-sticky-newest-wins-overlap-replay.ts")));

if (isEntrypoint) {
  runReplay(process.argv.slice(2)).then((code) => process.exit(code));
}

