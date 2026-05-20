// Integration: StickyApi.list paginates internally (mirroring GitHub's
// per_page) but returns the LEGACY plain StickyComment[] shape rather
// than { comments, pagesWalked }. Pin the scanStats fallback:
//   - pagesWalked defaults to 1 (the upsert can't know the impl
//     paginated under the hood — that's the cost of the legacy shape)
//   - commentsExamined equals the total flattened length across pages
//   - linesScanned is summed correctly over every comment from every page
//
// This complements ci-sticky-upsert-paginated-list.test.ts (which uses
// the rich shape) and ci-sticky-upsert-list-array-fallback.test.ts
// (which doesn't paginate).
import { describe, expect, it, vi } from "vitest";
import {
  MARKER_HEAD_SCAN_LINES,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:paginated-array-shape -->";

function makePaginatedArrayApi(pages: StickyComment[][]) {
  const state = pages.flat().map((c) => ({ ...c }));
  const pageCalls = vi.fn();
  const api: StickyApi = {
    // Walks N pages, returns FLAT ARRAY (legacy shape).
    list: async (): Promise<StickyComment[]> => {
      const out: StickyComment[] = [];
      for (const page of pages) {
        pageCalls();
        const alive = new Set(state.map((c) => c.id));
        for (const c of page) {
          if (!alive.has(c.id)) continue;
          const live = state.find((s) => s.id === c.id)!;
          out.push({ id: live.id, body: live.body });
        }
      }
      return out;
    },
    create: async (body) => {
      const c = { id: 99_999, body };
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

describe("paginated list with legacy array return shape", () => {
  it("3 pages × 2 comments, head-scan hits: pagesWalked falls back to 1, commentsExamined=6", async () => {
    const top = (tail: string) => `${MARKER}\n${tail}`;
    const t = makePaginatedArrayApi([
      [{ id: 10, body: top("p1-a") }, { id: 20, body: top("p1-b") }],
      [{ id: 30, body: top("p2-a") }, { id: 40, body: top("p2-b") }],
      [{ id: 50, body: top("p3-a") }, { id: 60, body: top("p3-b") }],
    ]);

    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });

    // The api walked 3 pages internally — but because it returned a
    // plain array, the upsert can't see that and reports pagesWalked=1.
    expect(t.pageCalls).toHaveBeenCalledTimes(3);
    expect(res.scanStats.pagesWalked).toBe(1);
    expect(res.scanStats.commentsExamined).toBe(6);
    // Marker on line 1 of every comment → 1 line scanned per comment.
    expect(res.scanStats.linesScanned).toBe(6);

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(60);
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([
      10, 20, 30, 40, 50,
    ]);
    expect(t.state.map((c) => c.id)).toEqual([60]);
  });

  it("3 pages, markers buried past head: full-scan fallback runs, linesScanned spans every comment on every page", async () => {
    const bury = (tail: string) =>
      [...Array.from({ length: 8 }, (_, i) => `pre ${i}`), MARKER, tail].join("\n");
    const t = makePaginatedArrayApi([
      [{ id: 1, body: bury("p1") }],
      [{ id: 2, body: bury("p2") }],
      [{ id: 3, body: bury("p3") }],
    ]);

    const res = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 3,
    });

    expect(res.scanStats.pagesWalked).toBe(1); // legacy shape default
    expect(res.scanStats.commentsExamined).toBe(3);
    // head: 3 lines × 3 comments = 9
    // full: 10 lines × 3 comments = 30 (8 noise + marker + tail)
    expect(res.scanStats.linesScanned).toBe(3 * 3 + 10 * 3);
    expect(res.usedFullScan).toBe(true);
    expect(res.comment.id).toBe(3);
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("paginated empty pages with legacy array shape still flatten to commentsExamined=0", async () => {
    const t = makePaginatedArrayApi([[], [], []]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });
    expect(t.pageCalls).toHaveBeenCalledTimes(3);
    expect(res.action).toBe("created");
    expect(res.scanStats).toEqual({
      pagesWalked: 1,
      commentsExamined: 0,
      linesScanned: 0,
    });
    // Sanity: no nonsense values.
    expect(res.scanStats.linesScanned).toBeLessThanOrEqual(MARKER_HEAD_SCAN_LINES);
  });
});
