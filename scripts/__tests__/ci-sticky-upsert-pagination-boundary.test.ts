// Integration: pagination + off-by-one head-scan boundary.
//
// Pins the exact `headScanLines` cutoff across paginated `list` results:
//   • A marker at line index N-1 (the last allowed slot when
//     headScanLines=N) MUST be found by the fast path.
//   • A marker at line index N (one past the window) MUST NOT be found
//     by the fast path; it only surfaces if the full-body fallback runs.
//
// The newest marker among comments WHERE THE FAST PATH MATCHED wins —
// the upsert picks it, and `usedFullScan` stays false because at least
// one head match exists. scanStats.linesScanned proves the per-comment
// bound was honored (headScanLines × commentsExamined).
import { describe, expect, it } from "vitest";
import {
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
  type StickyListMeta,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:boundary -->";

function bodyWithMarkerAt(line: number, tail: string): string {
  // 0-indexed line position for MARKER.
  const lines: string[] = [];
  for (let i = 0; i < line; i++) lines.push(`pre ${i}`);
  lines.push(MARKER);
  lines.push(tail);
  return lines.join("\n");
}

function makePaginatedApi(pages: StickyComment[][]) {
  const state = pages.flat().map((c) => ({ ...c }));
  const api: StickyApi = {
    list: async (): Promise<StickyListMeta> => {
      const all: StickyComment[] = [];
      for (const page of pages) {
        for (const c of page) {
          const live = state.find((s) => s.id === c.id);
          if (live) all.push({ ...live });
        }
      }
      return { comments: all, pagesWalked: pages.length };
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
  return { api, state };
}

describe("pagination + off-by-one head-scan boundary", () => {
  it("marker at exactly headScanLines-1 across pages is found via fast path; newest such match wins", async () => {
    const HEAD = 5;
    // 3 pages × 2 comments. Mix of:
    //   - markers at line index 4 (last allowed slot) → fast-path hit
    //   - markers at line index 5 (off by one)        → fast-path miss
    // Newest in-window match (highest id whose marker is within head)
    // must win, even though a higher-id comment has a marker just past
    // the window.
    const { api, state } = makePaginatedApi([
      [
        { id: 10, body: bodyWithMarkerAt(4, "p1-a in-window") }, // hit
        { id: 20, body: bodyWithMarkerAt(5, "p1-b off-by-one") }, // miss
      ],
      [
        { id: 30, body: bodyWithMarkerAt(4, "p2-a in-window newer") }, // hit
        { id: 40, body: bodyWithMarkerAt(5, "p2-b off-by-one") }, // miss
      ],
      [
        { id: 50, body: bodyWithMarkerAt(4, "p3-a in-window NEWEST") }, // hit
        { id: 60, body: bodyWithMarkerAt(5, "p3-b off-by-one, higher id") }, // miss
      ],
    ]);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: HEAD,
    });

    // Fast path succeeded — no fallback needed.
    expect(res.usedFullScan).toBe(false);
    // Newest fast-path match wins (id=50), NOT the higher-id off-by-one
    // comment (id=60). This is the boundary pin.
    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(50);
    // The two older in-window duplicates (10, 30) get cleaned up.
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([10, 30]);
    // Off-by-one comments (20, 40, 60) are UNTOUCHED — they didn't
    // match. State retains them.
    const ids = state.map((c) => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([20, 40, 50, 60]);

    // scanStats proves the per-comment bound: 6 comments × 5 lines = 30
    // for the head pass. No fallback engaged.
    expect(res.scanStats.pagesWalked).toBe(3);
    expect(res.scanStats.commentsExamined).toBe(6);
    expect(res.scanStats.linesScanned).toBe(6 * HEAD);
  });

  it("marker exactly AT headScanLines (index = N) is missed by fast path; full-scan rescues it", async () => {
    const HEAD = 5;
    // Every comment has the marker at line index 5 = OUTSIDE the
    // head window (headScanLines=5 inspects indices 0..4).
    const { api, state } = makePaginatedApi([
      [{ id: 100, body: bodyWithMarkerAt(5, "p1") }],
      [{ id: 200, body: bodyWithMarkerAt(5, "p2") }],
      [{ id: 300, body: bodyWithMarkerAt(5, "p3 newest") }],
    ]);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: HEAD,
    });

    expect(res.usedFullScan).toBe(true);
    expect(res.comment.id).toBe(300);
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([100, 200]);
    expect(state.map((c) => c.id)).toEqual([300]);

    // Head pass: 3 × 5 = 15 lines. Full pass: 3 × 7 = 21 lines
    // (5 preamble + marker + 1 tail = 7). Total = 36.
    expect(res.scanStats.pagesWalked).toBe(3);
    expect(res.scanStats.commentsExamined).toBe(3);
    expect(res.scanStats.linesScanned).toBe(3 * HEAD + 3 * 7);
  });
});
