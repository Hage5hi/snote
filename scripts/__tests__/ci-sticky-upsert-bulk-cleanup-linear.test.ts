// Stress: a single thread carries a VERY large number of marker
// duplicates (>= 1000). Cleanup must stay linear in the duplicate
// count — exactly `(N - 1)` remove calls, exactly 1 update on the
// newest, and the per-comment scan budget must not blow up
// (`scanStats.linesScanned <= comments * headScanLines` on the fast
// path, and bounded by `comments * (headScanLines + bodyLines)` on
// the fallback path).
//
// This complements ci-sticky-upsert-scan-perf-bound.test.ts which
// varies marker DEPTH at fixed thread shape; here we vary the THREAD
// SIZE at fixed shallow depth.
import { describe, expect, it, vi } from "vitest";
import {
  MARKER_HEAD_SCAN_LINES,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:bulk-cleanup -->";

function makeApi(n: number): {
  api: StickyApi;
  state: StickyComment[];
  list: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
} {
  const state: StickyComment[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    body: `${MARKER}\nold body ${i + 1}`,
  }));
  const list = vi.fn(async () => state.map((c) => ({ ...c })));
  const create = vi.fn(async (body: string) => {
    const c = { id: state.length + 1, body };
    state.push(c);
    return c;
  });
  const update = vi.fn(async (id: number, body: string) => {
    const c = state.find((x) => x.id === id)!;
    c.body = body;
    return { ...c };
  });
  const remove = vi.fn(async (id: number) => {
    const i = state.findIndex((x) => x.id === id);
    if (i >= 0) state.splice(i, 1);
  });
  return { api: { list, create, update, remove }, state, list, update, remove, create };
}

describe("duplicate cleanup is linear and respects scanStats budgets at scale", () => {
  it.each([100, 500, 1000, 2500])(
    "N=%i duplicates: 1 update, N-1 removes, scanStats stays within budget",
    async (N) => {
      const t = makeApi(N);
      const t0 = performance.now();
      const res = await upsertStickyComment({
        api: t.api,
        marker: MARKER,
        body: "fresh",
      });
      const elapsed = performance.now() - t0;

      expect(res.action).toBe("updated");
      expect(res.comment.id).toBe(N); // newest id wins
      expect(res.cleaned).toHaveLength(N - 1);
      expect(t.update).toHaveBeenCalledTimes(1);
      expect(t.remove).toHaveBeenCalledTimes(N - 1);
      expect(t.create).not.toHaveBeenCalled();
      expect(t.list).toHaveBeenCalledTimes(1);

      // scanStats budget: fast path only (markers at line 0), so
      // linesScanned must be exactly 1 per comment (stops at match).
      expect(res.scanStats.commentsExamined).toBe(N);
      expect(res.scanStats.pagesWalked).toBe(1);
      expect(res.scanStats.linesScanned).toBe(N);
      expect(res.scanStats.linesScanned).toBeLessThanOrEqual(N * MARKER_HEAD_SCAN_LINES);

      // Linear wall-clock guardrail. 2500 in-memory removes finish in
      // well under a generous 2s budget on every reasonable runner.
      expect(elapsed).toBeLessThan(2000);

      // Final state: exactly one comment survives, carrying the fresh body.
      expect(t.state).toHaveLength(1);
      expect(t.state[0].id).toBe(N);
      expect(t.state[0].body).toContain("fresh");
    },
  );

  it("scanStats remains linear with deep markers (fallback path) at N=500", async () => {
    const N = 500;
    const DEPTH = 12; // beyond default headScanLines=5
    const state: StickyComment[] = Array.from({ length: N }, (_, i) => ({
      id: i + 1,
      body: [...Array.from({ length: DEPTH }, (_, k) => `pre ${k}`), MARKER, "tail"].join("\n"),
    }));
    const api: StickyApi = {
      list: async () => state.map((c) => ({ ...c })),
      create: async () => ({ id: -1, body: "" }),
      update: async (id, body) => {
        const c = state.find((x) => x.id === id)!;
        c.body = body;
        return { ...c };
      },
      remove: async (id) => {
        const i = state.findIndex((x) => x.id === id);
        if (i >= 0) state.splice(i, 1);
      },
    };

    const res = await upsertStickyComment({ api, marker: MARKER, body: "fresh" });

    expect(res.usedFullScan).toBe(true);
    // Fast path: every comment burns the full headScan window (no match).
    // Fallback: every comment scans up to and including the marker line
    // (DEPTH + 1 = 13 lines). So total is N * (headScan + DEPTH+1).
    const expectedLines = N * MARKER_HEAD_SCAN_LINES + N * (DEPTH + 1);
    expect(res.scanStats.linesScanned).toBe(expectedLines);
    // Hard upper bound: linear in N. Catches accidental N² regressions.
    expect(res.scanStats.linesScanned).toBeLessThan(N * 100);
    expect(res.cleaned).toHaveLength(N - 1);
  });
});
