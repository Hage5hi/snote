// Integration: paginated list returns one or more EMPTY pages.
//
// Pins two properties:
//   1. Convergence — the upsert still finds the marker and cleans up
//      duplicates regardless of where empty pages fall (leading,
//      trailing, sandwiched, or all-but-one empty).
//   2. Bounded scan — empty pages contribute 0 lines to
//      `scanStats.linesScanned`. The head-scan budget stays exactly
//      `headScanLines × commentsExamined` (and `pagesWalked` reflects
//      every walked page, including empties).
import { describe, expect, it } from "vitest";
import {
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
  type StickyListMeta,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:empty-pages -->";

function topMarker(tail: string): string {
  return `${MARKER}\n${tail}`;
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

describe("paginated list with empty pages", () => {
  it("leading + trailing empty pages don't break convergence; budget unaffected", async () => {
    const HEAD = 5;
    const { api, state } = makePaginatedApi([
      [], // empty leading page
      [
        { id: 1, body: topMarker("oldest") },
        { id: 2, body: topMarker("middle") },
      ],
      [], // empty middle page
      [{ id: 3, body: topMarker("newest") }],
      [], // empty trailing page
    ]);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: HEAD,
    });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(3);
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(state.map((c) => c.id)).toEqual([3]);

    // Empty pages still count as walked.
    expect(res.scanStats.pagesWalked).toBe(5);
    // Only the 3 real comments contribute lines. Marker is at index 0
    // of each → head-scan short-circuits after 1 line per comment.
    expect(res.scanStats.commentsExamined).toBe(3);
    expect(res.scanStats.linesScanned).toBe(3 * 1);
    // Fast path succeeded → no fallback budget consumed.
    expect(res.usedFullScan).toBe(false);
    // Budget never exceeded the worst-case head bound.
    expect(res.scanStats.linesScanned).toBeLessThanOrEqual(
      res.scanStats.commentsExamined * HEAD,
    );
  });

  it("all-empty thread → create path; budget = 0; no fallback engaged", async () => {
    const { api, state } = makePaginatedApi([[], [], []]);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 5,
    });

    expect(res.action).toBe("created");
    expect(res.scanStats.pagesWalked).toBe(3);
    expect(res.scanStats.commentsExamined).toBe(0);
    expect(res.scanStats.linesScanned).toBe(0);
    expect(res.usedFullScan).toBe(false);
    // Created comment is the only one in state.
    expect(state.map((c) => c.body.startsWith(MARKER)).every(Boolean)).toBe(true);
    expect(state.length).toBe(1);
  });

  it("only the last page has the marker; budget stays bounded", async () => {
    const HEAD = 4;
    const { api } = makePaginatedApi([
      [], // empty
      [
        // Unrelated comments — no marker. Each has 10 lines but only
        // HEAD of them should be scanned.
        { id: 10, body: Array.from({ length: 10 }, (_, i) => `unrelated ${i}`).join("\n") },
        { id: 20, body: Array.from({ length: 10 }, (_, i) => `unrelated ${i}`).join("\n") },
      ],
      [], // empty
      [{ id: 30, body: topMarker("only marker, on last page") }],
    ]);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: HEAD,
    });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(30);
    expect(res.cleaned).toEqual([]);
    expect(res.usedFullScan).toBe(false);
    expect(res.scanStats.pagesWalked).toBe(4);
    expect(res.scanStats.commentsExamined).toBe(3);
    // id=10 and id=20: HEAD lines scanned each, no early exit.
    // id=30: marker at index 0 → 1 line.
    expect(res.scanStats.linesScanned).toBe(HEAD + HEAD + 1);
    expect(res.scanStats.linesScanned).toBeLessThanOrEqual(
      res.scanStats.commentsExamined * HEAD,
    );
  });
});
