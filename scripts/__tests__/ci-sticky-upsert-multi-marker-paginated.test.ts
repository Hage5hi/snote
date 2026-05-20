// Integration: a paginated list returns multiple marker-bearing
// comments per page AND some bodies contain the marker more than once
// (e.g. a quoted reply). The fast-path head-scan budget must stay
// bounded per comment — duplicate markers inside one body do NOT
// multiply scan work — and the NEWEST id across all pages must still
// win.
import { describe, expect, it } from "vitest";
import {
  MARKER_HEAD_SCAN_LINES,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:multi-marker-paginated -->";

/** Body where the marker appears N times, all within the head window. */
function multiMarkerBody(n: number, tail: string): string {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(MARKER);
  lines.push(tail);
  return lines.join("\n");
}

function makePaginatedApi(pages: StickyComment[][]) {
  const state = pages.flat().map((c) => ({ ...c }));
  let pagesWalked = 0;
  const api: StickyApi = {
    list: async () => {
      const comments: StickyComment[] = [];
      pagesWalked = 0;
      for (const page of pages) {
        pagesWalked++;
        const alive = page.filter((c) => state.some((s) => s.id === c.id));
        for (const c of alive) {
          const live = state.find((s) => s.id === c.id)!;
          comments.push({ id: live.id, body: live.body });
        }
      }
      return { comments, pagesWalked };
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
  return { api, state, getPagesWalked: () => pagesWalked };
}

describe("multi-marker bodies across paginated pages — headScanLines stays bounded", () => {
  it("newest id wins; per-comment scan stops at first match (linesScanned = 1 per comment)", async () => {
    // 3 pages × 2 comments. Each body has 3 marker occurrences within
    // the head window (so the matcher should stop at line 0).
    const { api, state, getPagesWalked } = makePaginatedApi([
      [
        { id: 11, body: multiMarkerBody(3, "p1-a") },
        { id: 22, body: multiMarkerBody(3, "p1-b") },
      ],
      [
        { id: 33, body: multiMarkerBody(3, "p2-a") },
        { id: 44, body: multiMarkerBody(3, "p2-b") },
      ],
      [
        { id: 55, body: multiMarkerBody(3, "p3-a") },
        { id: 66, body: multiMarkerBody(3, "p3-b") }, // newest
      ],
    ]);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 5,
    });

    // Pagination + counters reported precisely.
    expect(res.scanStats.pagesWalked).toBe(3);
    expect(res.scanStats.commentsExamined).toBe(6);
    // Each body's first line is the marker → scanForMarker returns after
    // 1 line per comment. 6 comments × 1 line = 6.
    expect(res.scanStats.linesScanned).toBe(6);
    // Strict bound: never exceeds N * headScanLines.
    expect(res.scanStats.linesScanned).toBeLessThanOrEqual(
      6 * MARKER_HEAD_SCAN_LINES,
    );

    // Fast path succeeded → no full-scan engagement.
    expect(res.usedFullScan).toBe(false);

    // Newest id across all pages wins; older 5 are cleaned.
    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(66);
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([
      11, 22, 33, 44, 55,
    ]);
    expect(state.map((c) => c.id)).toEqual([66]);
    expect(getPagesWalked()).toBe(3);
  });

  it("mixed: some bodies have the marker shallow, others have it buried — bound still holds", async () => {
    // Bodies on page 1 have the marker at line 0 (single occurrence).
    // Bodies on page 2 have the marker buried at depth 10 with multiple
    // occurrences buried alongside it. headScanLines=5 → page-2 bodies
    // burn the full window without matching, then the fallback engages.
    const buried = (n: number, tail: string) => {
      const pre = Array.from({ length: 10 }, (_, i) => `pre ${i}`);
      const reps: string[] = [];
      for (let i = 0; i < n; i++) reps.push(MARKER);
      return [...pre, ...reps, tail].join("\n");
    };
    const { api, state } = makePaginatedApi([
      [
        { id: 1, body: `${MARKER}\nshallow-1` },
        { id: 2, body: `${MARKER}\nshallow-2` },
      ],
      [
        { id: 3, body: buried(2, "deep-3") },
        { id: 4, body: buried(2, "deep-4") }, // newest
      ],
    ]);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 5,
    });

    // Head-scan found 2 matches (ids 1 and 2) on the shallow page,
    // so fallback should NOT engage even though deeper bodies also
    // contain the marker. Newest among the head matches is id=2.
    expect(res.usedFullScan).toBe(false);
    expect(res.comment.id).toBe(2);
    // Deep markers (ids 3, 4) are NOT cleaned in this pass — they were
    // invisible to the fast path. The convergence contract handles them
    // on the next run; here we just pin "head-scan bound is honored
    // even when deep markers exist elsewhere".
    expect(res.cleaned.map((c) => c.id)).toEqual([1]);
    expect(state.map((c) => c.id).sort((a, b) => a - b)).toEqual([2, 3, 4]);

    // Head-scan budget: 2 comments stopped at line 0 (1 line each),
    // 2 comments burned the full 5-line window without matching → 12.
    expect(res.scanStats.linesScanned).toBe(1 + 1 + 5 + 5);
    expect(res.scanStats.linesScanned).toBeLessThanOrEqual(4 * 5);
  });
});
