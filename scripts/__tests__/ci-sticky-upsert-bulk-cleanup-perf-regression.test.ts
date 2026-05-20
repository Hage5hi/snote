// Perf regression guard: large duplicate-cleanup runs must stay
// linear in the duplicate count and complete within a strict wall-
// clock budget. Complements
// `ci-sticky-upsert-bulk-cleanup-linear.test.ts` (which pins the
// API call profile + scanStats shape); this file pins the TIMING
// envelope so an accidental N² regression (e.g. nested rescans,
// per-delete re-list) blows up here loudly.
//
// Methodology: run the upsert across an exponentially growing series
// of duplicate counts, capture wall-clock per N, and assert two
// guardrails:
//
//   1. Hard absolute caps per N (generous, runner-friendly).
//   2. Linearity: per-duplicate cost at the largest N is not more
//      than 4× the per-duplicate cost at the smallest N. A truly
//      linear implementation hovers near 1×; ~4× tolerates GC noise,
//      JIT warmup, and CI shared-runner jitter without false reds.
//
// A compact timing line is logged per N when STICKY_TEST_SUMMARY=1
// so PR debug bundles include the perf shape inline.
import { describe, expect, it } from "vitest";
import {
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";
import { summarizeScan } from "./_helpers/sticky-scan-summary";

const MARKER = "<!-- sticky:perf-regression -->";

function makeApi(n: number): { api: StickyApi; state: StickyComment[] } {
  const state: StickyComment[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    body: `${MARKER}\nold body ${i + 1}`,
  }));
  return {
    state,
    api: {
      list: async () => state.map((c) => ({ ...c })),
      create: async (body) => {
        const c = { id: state.length + 1, body };
        state.push(c);
        return c;
      },
      update: async (id, body) => {
        const c = state.find((x) => x.id === id)!;
        c.body = body;
        return { ...c };
      },
      remove: async (id) => {
        const i = state.findIndex((x) => x.id === id);
        if (i >= 0) state.splice(i, 1);
      },
    },
  };
}

interface Sample {
  n: number;
  elapsedMs: number;
  perItemUs: number; // microseconds per duplicate
}

describe("perf regression: duplicate cleanup stays linear under load", () => {
  // Default absolute caps per N — generous, runner-friendly. CI can
  // tighten or relax these per environment via STICKY_PERF_CAP_MS_<N>
  // and the linearity ratio via STICKY_PERF_RATIO_MAX, without
  // touching test source. Memory cap (heapUsed delta, MB) is gated by
  // STICKY_PERF_MEM_CAP_MB; unset disables the memory assertion.
  function envCap(n: number, fallback: number): number {
    const raw = process.env[`STICKY_PERF_CAP_MS_${n}`];
    if (!raw) return fallback;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }
  const CAPS: Record<number, number> = {
    100: envCap(100, 250),
    500: envCap(500, 500),
    2000: envCap(2000, 1500),
    5000: envCap(5000, 4000),
  };
  const RATIO_MAX = (() => {
    const raw = process.env.STICKY_PERF_RATIO_MAX;
    const v = raw ? Number(raw) : NaN;
    return Number.isFinite(v) && v > 0 ? v : 4;
  })();
  const MEM_CAP_MB = (() => {
    const raw = process.env.STICKY_PERF_MEM_CAP_MB;
    if (!raw) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  })();

  it("linearity + absolute timing caps across N ∈ {100, 500, 2000, 5000}", async () => {
    const samples: Sample[] = [];

    for (const N of [100, 500, 2000, 5000]) {
      const { api, state } = makeApi(N);
      const memBefore =
        typeof process.memoryUsage === "function" ? process.memoryUsage().heapUsed : 0;
      const t0 = performance.now();
      const res = await upsertStickyComment({ api, marker: MARKER, body: "fresh" });
      const elapsed = performance.now() - t0;
      const memAfter =
        typeof process.memoryUsage === "function" ? process.memoryUsage().heapUsed : 0;
      const memDeltaMb = (memAfter - memBefore) / (1024 * 1024);
      summarizeScan(`perf N=${N}`, res);

      // Correctness pins.
      expect(res.action).toBe("updated");
      expect(res.cleaned).toHaveLength(N - 1);
      expect(state).toHaveLength(1);

      // Absolute time cap.
      expect(
        elapsed,
        `N=${N} took ${elapsed.toFixed(1)}ms, cap ${CAPS[N]}ms ` +
          `(override via STICKY_PERF_CAP_MS_${N})`,
      ).toBeLessThan(CAPS[N]);

      // Optional memory cap.
      if (MEM_CAP_MB != null) {
        expect(
          memDeltaMb,
          `N=${N} heapUsed delta ${memDeltaMb.toFixed(1)}MB, cap ${MEM_CAP_MB}MB ` +
            `(override via STICKY_PERF_MEM_CAP_MB)`,
        ).toBeLessThan(MEM_CAP_MB);
      }

      samples.push({
        n: N,
        elapsedMs: elapsed,
        perItemUs: (elapsed / N) * 1000,
      });

      if (process.env.STICKY_TEST_SUMMARY === "1") {
        // eslint-disable-next-line no-console
        console.log(
          `[sticky-perf] N=${String(N).padStart(5)} ` +
            `elapsed=${elapsed.toFixed(1).padStart(7)}ms ` +
            `per-item=${samples[samples.length - 1].perItemUs.toFixed(2)}µs ` +
            `mem=${memDeltaMb.toFixed(2)}MB`,
        );
      }
    }

    // Linearity check: ratio of per-item cost at largest N vs smallest N.
    const smallest = samples[0];
    const largest = samples[samples.length - 1];
    // Guard against ~0ms divisions (very fast runners): floor at 1µs.
    const ratio = largest.perItemUs / Math.max(smallest.perItemUs, 1);
    expect(
      ratio,
      `per-item cost ratio largest/smallest = ${ratio.toFixed(2)}× ` +
        `(${largest.n}→${largest.perItemUs.toFixed(2)}µs vs ` +
        `${smallest.n}→${smallest.perItemUs.toFixed(2)}µs); ` +
        `expected ≤ ${RATIO_MAX}× for linear cleanup ` +
        `(override via STICKY_PERF_RATIO_MAX)`,
    ).toBeLessThanOrEqual(RATIO_MAX);
  }, 30_000);

  it("repeated reruns on a converged thread are O(1) — no scan blowup", async () => {
    const { api } = makeApi(2000);
    // First run: heavy cleanup.
    const first = await upsertStickyComment({ api, marker: MARKER, body: "fresh" });
    expect(first.cleaned).toHaveLength(1999);

    // Subsequent reruns: just an update, no cleanup. Should be tiny.
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      const r = await upsertStickyComment({
        api,
        marker: MARKER,
        body: `rerun ${i}`,
      });
      expect(r.cleaned).toHaveLength(0);
    }
    const elapsed = performance.now() - t0;
    expect(
      elapsed,
      `20 idempotent reruns took ${elapsed.toFixed(1)}ms; expected < 250ms`,
    ).toBeLessThan(250);
  });
});
