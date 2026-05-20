// Shared test helpers for the sticky-upsert suite:
//
//   • runFuzzWithSeed  — wraps a fuzz loop so any failing iteration
//     prints the EXACT seed + iteration index + offending inputs to
//     stderr AND writes a replay artifact JSON file so failures
//     reproduce locally with one command. The artifact captures the
//     marker variant, normalization path actually taken (head-scan
//     vs full-scan), the matcher return values, and any computed
//     cleaned IDs the body chooses to surface.
//
//   • summarizeScan    — compact, single-line, human-readable digest
//     of an `UpsertResult.scanStats` + `usedFullScan` flag PLUS a
//     machine-readable JSONL line (one record per scenario) appended
//     to `reports/_ci/sticky-scan-summary.jsonl` so downstream CI
//     tooling can parse per-scenario telemetry without scraping logs.
//
// Kept dependency-free (only `node:fs` / `node:path`) so it works
// under bun/node/vitest equally.
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { UpsertResult } from "../../ci-sticky-pr-comment-upsert";

const fuzzArtifactDir = () =>
  process.env.STICKY_FUZZ_ARTIFACT_DIR ?? "reports/_ci/sticky-fuzz-failures";
const scanSummaryJsonl = () =>
  process.env.STICKY_SCAN_SUMMARY_JSONL ?? "reports/_ci/sticky-scan-summary.jsonl";

/** Read the fuzz seed from env or fall back. Logged on failure. */
export function fuzzSeed(fallback: number): number {
  const raw = process.env.STICKY_FUZZ_SEED;
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : fallback;
}

/**
 * Run `iterations` of `body(rng, i, ctx)`. The body should attach as
 * much diagnostic context as it can to `ctx.extra` (marker variant,
 * normalization path, matcher results, cleaned IDs, etc.) so that on
 * failure we can write a JSON artifact rich enough to replay locally.
 *
 * On failure we:
 *   1. Write `reports/_ci/sticky-fuzz-failures/<name>-<seed>-<i>.json`
 *      with the full repro payload.
 *   2. Print a compact stderr block including the artifact path and
 *      the exact reproduce command.
 *   3. Re-throw so vitest still fails.
 */
export function runFuzzWithSeed(opts: {
  name: string;
  seed: number;
  iterations: number;
  rng: () => number;
  body: (rng: () => number, i: number, ctx: { extra?: unknown }) => void;
}): void {
  const { name, seed, iterations, rng, body } = opts;
  for (let i = 0; i < iterations; i++) {
    const ctx: { extra?: unknown } = {};
    try {
      body(rng, i, ctx);
    } catch (err) {
      const artifactPath = writeFuzzFailureArtifact({
        name,
        seed,
        iteration: i,
        extra: ctx.extra,
        error: (err as Error)?.message ?? String(err),
      });
      const repro =
        `\n[sticky-fuzz] FAILURE — ${name}\n` +
        `[sticky-fuzz]   STICKY_FUZZ_SEED=${seed} iteration=${i}\n` +
        (ctx.extra !== undefined
          ? `[sticky-fuzz]   inputs=${safeJson(ctx.extra)}\n`
          : "") +
        (artifactPath
          ? `[sticky-fuzz]   artifact=${artifactPath}\n`
          : "") +
        `[sticky-fuzz]   reproduce: STICKY_FUZZ_SEED=${seed} bunx vitest run <file>\n`;
      // eslint-disable-next-line no-console
      console.error(repro);
      throw err;
    }
  }
}

function writeFuzzFailureArtifact(payload: {
  name: string;
  seed: number;
  iteration: number;
  extra: unknown;
  error: string;
}): string | null {
  try {
    mkdirSync(FUZZ_ARTIFACT_DIR, { recursive: true });
    const safeName = payload.name.replace(/[^a-zA-Z0-9_-]+/g, "-");
    const path = join(
      FUZZ_ARTIFACT_DIR,
      `${safeName}-seed${payload.seed}-iter${payload.iteration}.json`,
    );
    const record = {
      schema: "sticky-fuzz-failure/v1",
      name: payload.name,
      seed: payload.seed,
      iteration: payload.iteration,
      timestamp: new Date().toISOString(),
      error: payload.error,
      reproduce: `STICKY_FUZZ_SEED=${payload.seed} bunx vitest run`,
      inputs: payload.extra ?? null,
    };
    writeFileSync(path, JSON.stringify(record, null, 2) + "\n", "utf8");
    return path;
  } catch {
    return null;
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * One-line scan summary (human-readable) + JSONL record (machine-
 * readable) appended to `reports/_ci/sticky-scan-summary.jsonl`.
 * Gated by STICKY_TEST_SUMMARY=1. Both outputs are toggled together
 * so downstream tooling never has half a picture.
 */
export function summarizeScan(label: string, res: UpsertResult): void {
  if (process.env.STICKY_TEST_SUMMARY !== "1") return;
  const s = res.scanStats;
  // eslint-disable-next-line no-console
  console.log(
    `[sticky-scan] ${label.padEnd(48)} ` +
      `action=${res.action} ` +
      `id=${res.comment.id} ` +
      `cleaned=${res.cleaned.length} ` +
      `usedFullScan=${res.usedFullScan} ` +
      `pages=${s.pagesWalked} ` +
      `comments=${s.commentsExamined} ` +
      `lines=${s.linesScanned}`,
  );
  const record = {
    schema: "sticky-scan-summary/v1",
    label,
    action: res.action,
    id: res.comment.id,
    cleaned: res.cleaned.length,
    cleanedIds: res.cleaned.map((c) => c.id),
    usedFullScan: res.usedFullScan,
    scanStats: s,
    timestamp: new Date().toISOString(),
  };
  // eslint-disable-next-line no-console
  console.log(`[sticky-scan-json] ${JSON.stringify(record)}`);
  try {
    mkdirSync(dirname(SCAN_SUMMARY_JSONL), { recursive: true });
    appendFileSync(SCAN_SUMMARY_JSONL, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // Non-fatal — log line is still emitted above.
  }
}
