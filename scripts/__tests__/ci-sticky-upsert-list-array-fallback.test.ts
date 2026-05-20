// Integration: StickyApi.list returns a plain StickyComment[] (the
// backward-compatible shape) instead of a StickyListMeta object.
//
// Pins the fallback contract:
//   - scanStats.pagesWalked defaults to 1
//   - scanStats.commentsExamined equals the array length
//   - scanStats.linesScanned is still computed from per-comment head scan
//   - upsert still selects newest + cleans up duplicates
import { describe, expect, it, vi } from "vitest";
import {
  MARKER_HEAD_SCAN_LINES,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:list-array-fallback -->";

function makeArrayApi(seed: StickyComment[]) {
  const state = seed.map((c) => ({ ...c }));
  let nextId = state.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  // Plain array shape — NOT { comments, pagesWalked }.
  const list = vi.fn(async (): Promise<StickyComment[]> =>
    state.map((c) => ({ ...c })),
  );
  const create = vi.fn(async (body: string) => {
    const c = { id: nextId++, body };
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
  const api: StickyApi = { list, create, update, remove };
  return { api, state };
}

describe("StickyApi.list array return value (legacy shape)", () => {
  it("empty array → action=created, pagesWalked=1, commentsExamined=0, linesScanned=0", async () => {
    const t = makeArrayApi([]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });
    expect(res.action).toBe("created");
    expect(res.scanStats).toEqual({
      pagesWalked: 1,
      commentsExamined: 0,
      linesScanned: 0,
    });
  });

  it("multiple comments with marker → updates newest, cleans older, pagesWalked stays 1", async () => {
    const t = makeArrayApi([
      { id: 11, body: `${MARKER}\nold` },
      { id: 22, body: `${MARKER}\nnewer` },
      { id: 33, body: "unrelated review comment" },
    ]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(22);
    expect(res.cleaned).toEqual([{ id: 11, via: "delete" }]);
    expect(res.scanStats.pagesWalked).toBe(1);
    expect(res.scanStats.commentsExamined).toBe(3);
    // Marker matches on line 1 in comments 11 and 22 (1 line each).
    // Unrelated comment is single-line; head scan walks 1 line.
    expect(res.scanStats.linesScanned).toBe(3);
  });

  it("no marker matches → full-scan fallback engaged; pagesWalked still defaults to 1", async () => {
    const longBody = Array.from({ length: 10 }, (_, i) => `noise-${i}`).join("\n");
    const t = makeArrayApi([
      { id: 1, body: longBody },
      { id: 2, body: longBody },
    ]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });

    expect(res.action).toBe("created");
    expect(res.scanStats.pagesWalked).toBe(1);
    expect(res.scanStats.commentsExamined).toBe(2);
    // head: 5 lines × 2 + full: 10 lines × 2
    expect(res.scanStats.linesScanned).toBe(MARKER_HEAD_SCAN_LINES * 2 + 10 * 2);
  });

  it("array shape works with lock cleanup strategy too", async () => {
    const t = makeArrayApi([
      { id: 1, body: `${MARKER}\nold` },
      { id: 2, body: `${MARKER}\nnewer` },
    ]);
    const res = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "fresh",
      cleanupStrategy: "lock",
    });
    expect(res.cleaned).toEqual([{ id: 1, via: "lock" }]);
    expect(res.scanStats.pagesWalked).toBe(1);
  });
});
