// Shared test helpers for the sticky-upsert suite:
//
//   • runFuzzWithSeed  — wraps a fuzz loop so any failing iteration
//     prints the EXACT seed + iteration index + offending inputs to
//     stderr before re-throwing, so failures reproduce locally with
//     `STICKY_FUZZ_SEED=<n> bunx vitest run <file>`.
//
//   • summarizeScan    — compact, single-line, human-readable digest
//     of an `UpsertResult.scanStats` + `usedFullScan` flag. Used by
//     scenario-driven tests to print a per-case summary so CI logs
//     show the marker-scan profile inline without flooding stdout.
//
// Kept dependency-free so it works under bun/node/vitest equally.
import type { UpsertResult } from "../../ci-sticky-pr-comment-upsert";

/** Read the fuzz seed from env or fall back. Logged on failure. */
export function fuzzSeed(fallback: number): number {
  const raw = process.env.STICKY_FUZZ_SEED;
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : fallback;
}

/**
 * Run `iterations` of `body(rng, i)`. If `body` throws, print the
 * exact seed + iteration + any extra context the body attaches via
 * the `ctx` mutator, then re-throw so vitest still fails.
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
      const repro =
        `\n[sticky-fuzz] FAILURE — ${name}\n` +
        `[sticky-fuzz]   STICKY_FUZZ_SEED=${seed} iteration=${i}\n` +
        (ctx.extra !== undefined
          ? `[sticky-fuzz]   inputs=${safeJson(ctx.extra)}\n`
          : "") +
        `[sticky-fuzz]   reproduce: STICKY_FUZZ_SEED=${seed} bunx vitest run <file>\n`;
      // eslint-disable-next-line no-console
      console.error(repro);
      throw err;
    }
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
 * One-line scan summary. Toggle with STICKY_TEST_SUMMARY=1 (default on
 * in CI by setting it in the workflow step env). Always callable —
 * tests don't need to branch on the env.
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
}
