// CI assertion matrix: scanStats budgets (pagesWalked,
// commentsExamined, linesScanned) must stay within strict upper
// bounds across both the head-scan fast path and the full-body
// fallback. Covers every combination of:
//
//   • pages walked        : 1 (plain array) vs N (meta shape)
//   • marker depth        : at line 0 (fast path wins) vs deep
//                          (fallback engages)
//   • thread size         : small (3) vs medium (50)
//
// Per-scenario upper bounds (the contract this test pins):
//
//   pagesWalked      <= configured pages, and == 1 for plain arrays
//   commentsExamined == total comments returned by list()
//   linesScanned     <= comments × headScanLines  (fast path only)
//   linesScanned     <= comments × (headScanLines + bodyLines+1)
//                       (fallback engaged)
//
// Prints a compact per-scenario summary line (controlled by
// STICKY_TEST_SUMMARY=1) so CI logs reveal the scan profile at a
// glance.
import { describe, expect, it } from "vitest";
import {
  MARKER_HEAD_SCAN_LINES,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
  type StickyListMeta,
} from "../ci-sticky-pr-comment-upsert";
import { summarizeScan } from "./_helpers/sticky-scan-summary";

const MARKER = "<!-- sticky:scan-stats-budgets -->";

function shallow(id: number, tail: string): StickyComment {
  return { id, body: `${MARKER}\n${tail}` };
}
function buried(id: number, depth: number, tail: string): StickyComment {
  const pre = Array.from({ length: depth }, (_, i) => `pre ${i}`);
  return { id, body: [...pre, MARKER, tail].join("\n") };
}

function plainApi(comments: StickyComment[]): StickyApi {
  const state = comments.map((c) => ({ ...c }));
  return {
    list: async () => state.map((c) => ({ ...c })),
    create: async (body) => ({ id: 999999, body }),
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
}

function metaApi(pages: StickyComment[][]): StickyApi {
  const state = pages.flat().map((c) => ({ ...c }));
  return {
    list: async (): Promise<StickyListMeta> => {
      const comments: StickyComment[] = [];
      for (const page of pages) {
        for (const c of page) {
          const live = state.find((s) => s.id === c.id);
          if (live) comments.push({ id: live.id, body: live.body });
        }
      }
      return { comments, pagesWalked: pages.length };
    },
    create: async (body) => ({ id: 999999, body }),
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
}

describe("scanStats budgets — upper-bound assertion matrix", () => {
  it("plain array + shallow markers (fast path): pages=1, lines == comments", async () => {
    const N = 3;
    const api = plainApi(Array.from({ length: N }, (_, i) => shallow(i + 1, `t${i}`)));
    const res = await upsertStickyComment({ api, marker: MARKER, body: "fresh" });
    summarizeScan("plain+shallow N=3", res);

    expect(res.usedFullScan).toBe(false);
    expect(res.scanStats.pagesWalked).toBe(1);
    expect(res.scanStats.commentsExamined).toBe(N);
    // Stops at line 0 per comment.
    expect(res.scanStats.linesScanned).toBe(N);
    // Strict upper bound.
    expect(res.scanStats.linesScanned).toBeLessThanOrEqual(N * MARKER_HEAD_SCAN_LINES);
  });

  it("meta paginated + shallow markers (fast path): pages reported precisely", async () => {
    const api = metaApi([
      [shallow(1, "a"), shallow(2, "b")],
      [shallow(3, "c")],
      [shallow(4, "d"), shallow(5, "e")],
    ]);
    const res = await upsertStickyComment({ api, marker: MARKER, body: "fresh" });
    summarizeScan("meta+shallow pages=3", res);

    expect(res.usedFullScan).toBe(false);
    expect(res.scanStats.pagesWalked).toBe(3);
    expect(res.scanStats.commentsExamined).toBe(5);
    expect(res.scanStats.linesScanned).toBe(5); // 1 per comment
    expect(res.scanStats.linesScanned).toBeLessThanOrEqual(5 * MARKER_HEAD_SCAN_LINES);
  });

  it("plain array + deep markers (fallback path): lines bounded by head+body per comment", async () => {
    const N = 3;
    const DEPTH = 10;
    const api = plainApi(Array.from({ length: N }, (_, i) => buried(i + 1, DEPTH, `t${i}`)));
    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 5,
    });
    summarizeScan("plain+deep N=3", res);

    expect(res.usedFullScan).toBe(true);
    expect(res.scanStats.pagesWalked).toBe(1);
    expect(res.scanStats.commentsExamined).toBe(N);
    // Head burns 5 each + fallback walks until marker (DEPTH+1 lines).
    expect(res.scanStats.linesScanned).toBe(N * 5 + N * (DEPTH + 1));
    // Hard upper bound: per comment, head + (total body lines).
    const bodyLines = DEPTH + 2; // pre + marker + tail
    expect(res.scanStats.linesScanned).toBeLessThanOrEqual(N * (5 + bodyLines));
  });

  it("meta paginated + deep markers (fallback path): pages preserved, lines bounded", async () => {
    const DEPTH = 8;
    const api = metaApi([
      [buried(1, DEPTH, "a"), buried(2, DEPTH, "b")],
      [buried(3, DEPTH, "c")],
    ]);
    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 5,
    });
    summarizeScan("meta+deep pages=2", res);

    expect(res.usedFullScan).toBe(true);
    expect(res.scanStats.pagesWalked).toBe(2);
    expect(res.scanStats.commentsExamined).toBe(3);
    expect(res.scanStats.linesScanned).toBe(3 * 5 + 3 * (DEPTH + 1));
    expect(res.scanStats.linesScanned).toBeLessThanOrEqual(3 * (5 + DEPTH + 2));
  });

  it("medium thread (N=50, fast path): aggregate budget never exceeds N*headScanLines", async () => {
    const N = 50;
    const api = plainApi(Array.from({ length: N }, (_, i) => shallow(i + 1, `t${i}`)));
    const res = await upsertStickyComment({ api, marker: MARKER, body: "fresh" });
    summarizeScan("plain+shallow N=50", res);

    expect(res.usedFullScan).toBe(false);
    expect(res.scanStats.commentsExamined).toBe(N);
    expect(res.scanStats.linesScanned).toBe(N);
    expect(res.scanStats.linesScanned).toBeLessThanOrEqual(N * MARKER_HEAD_SCAN_LINES);
  });

  it("medium thread (N=50, fallback path): aggregate stays linear in N", async () => {
    const N = 50;
    const DEPTH = 12;
    const api = plainApi(Array.from({ length: N }, (_, i) => buried(i + 1, DEPTH, `t${i}`)));
    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 5,
    });
    summarizeScan("plain+deep N=50", res);

    expect(res.usedFullScan).toBe(true);
    const upper = N * (5 + DEPTH + 2);
    expect(res.scanStats.linesScanned).toBeLessThanOrEqual(upper);
    // Catches any accidental quadratic regression.
    expect(res.scanStats.linesScanned).toBeLessThan(N * 100);
  });
});
