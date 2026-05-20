// Integration: the sticky comments list API paginates results internally
// (mirroring GitHub's per_page=100). Marker scanning must still respect
// headScanLines across ALL pages — i.e. a marker buried past the head
// window in a comment on a later page must NOT be found by the fast
// path, and the full-body fallback must rescue it without expanding the
// per-comment scan budget.
import { describe, expect, it, vi } from "vitest";
import {
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:paginated -->";

function bury(depth: number, tail = "body"): string {
  return [
    ...Array.from({ length: depth }, (_, i) => `pre ${i}`),
    MARKER,
    tail,
  ].join("\n");
}

/**
 * API whose `list` walks N internal pages (per_page=2) and returns the
 * flattened result. The upsert calls list() once; the test asserts the
 * marker-scan bound holds across the merged pages.
 */
function makePaginatedApi(pages: StickyComment[][]) {
  const state = pages.flat().map((c) => ({ ...c }));
  const pageCalls = vi.fn();
  const api: StickyApi = {
    list: async () => {
      // Simulate internal pagination: walk each page, accumulate.
      const out: StickyComment[] = [];
      for (const page of pages) {
        pageCalls();
        out.push(...page.map((c) => ({ ...c })));
      }
      // Return current state for ids we still know about (so reruns
      // see the effect of prior cleanups). Anything not in state was
      // removed.
      const alive = new Set(state.map((c) => c.id));
      return out.filter((c) => alive.has(c.id)).map((c) => {
        const live = state.find((s) => s.id === c.id)!;
        return { id: live.id, body: live.body };
      });
    },
    create: async (body) => {
      const c = { id: 999999, body };
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
  };
  return { api, state, pageCalls };
}

describe("paginated list — marker scanning bounded across pages", () => {
  it("head-scan misses deep markers on later pages; full-scan rescues exactly once", async () => {
    // 3 pages × 2 comments. Markers buried at depth=15 in every comment,
    // including comments on pages 2 and 3.
    const { api, state, pageCalls } = makePaginatedApi([
      [
        { id: 10, body: bury(15, "p1-a") },
        { id: 20, body: bury(15, "p1-b") },
      ],
      [
        { id: 30, body: bury(15, "p2-a") },
        { id: 40, body: bury(15, "p2-b") },
      ],
      [
        { id: 50, body: bury(15, "p3-a") },
        { id: 60, body: bury(15, "p3-b") }, // newest
      ],
    ]);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 5, // smaller than bury depth
    });

    // All 3 pages were walked exactly once (single list() call).
    expect(pageCalls).toHaveBeenCalledTimes(3);

    // Head-scan found nothing → full-scan fallback engaged.
    expect(res.usedFullScan).toBe(true);
    // Newest across all pages wins.
    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(60);
    // All 5 older duplicates (across all pages) cleaned up.
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([
      10, 20, 30, 40, 50,
    ]);
    expect(state.map((c) => c.id)).toEqual([60]);
  });

  it("head-scan window honored across pages when markers ARE near the top", async () => {
    // Markers at line 0 of every comment, spread across 3 pages.
    const top = (tail: string) => `${MARKER}\n${tail}`;
    const { api, state } = makePaginatedApi([
      [{ id: 1, body: top("p1") }],
      [{ id: 2, body: top("p2") }],
      [{ id: 3, body: top("p3") }],
    ]);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 5,
    });

    expect(res.usedFullScan).toBe(false); // fast path succeeded
    expect(res.comment.id).toBe(3);
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(state.map((c) => c.id)).toEqual([3]);
  });
});
