// Perf bound: marker scanning must stay bounded by headScanLines and at
// most ONE full-body fallback pass. The API call count for list/create/
// update/remove MUST NOT grow with the depth of where the marker sits
// in each comment body — only with the number of comments in the
// thread (which we hold constant across scenarios).
import { describe, expect, it, vi } from "vitest";
import {
  hasStickyMarker,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky-test-marker -->";

function buryMarker(depth: number, marker = MARKER): string {
  const filler = Array.from({ length: depth }, (_, i) => `preamble line ${i}`);
  return [...filler, marker, "body content here"].join("\n");
}

function makeApi(comments: StickyComment[]) {
  const state = comments.map((c) => ({ ...c }));
  const list = vi.fn(async () => state.map((c) => ({ ...c })));
  const create = vi.fn(async (body: string) => {
    const c = { id: 999999, body };
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
  return { api, state, list, create, update, remove };
}

describe("marker scanning is bounded by headScanLines + 1 full-scan fallback", () => {
  it("hasStickyMarker(headScan): does NOT find marker buried past the window", () => {
    const body = buryMarker(20);
    expect(hasStickyMarker(body, MARKER, { headScanLines: 5 })).toBe(false);
    expect(hasStickyMarker(body, MARKER, { headScanLines: 25 })).toBe(true);
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(true);
  });

  it.each([
    ["shallow (marker at line 0)", 0],
    ["just past head window (depth=10)", 10],
    ["very deep (depth=500)", 500],
    ["pathologically deep (depth=5000)", 5000],
  ])(
    "API call count stays constant regardless of marker depth — %s",
    async (_label, depth) => {
      // Three comments in the thread, two with buried markers + one
      // newest with a buried marker. The depth varies but the THREAD
      // SHAPE (3 comments, 3 marker matches) is identical, so the API
      // call profile must also be identical.
      const t = makeApi([
        { id: 100, body: buryMarker(depth) },
        { id: 200, body: buryMarker(depth) },
        { id: 300, body: buryMarker(depth) },
      ]);

      const res = await upsertStickyComment({
        api: t.api,
        marker: MARKER,
        body: "fresh body",
        // Force the full-scan fallback path by keeping headScanLines small.
        headScanLines: 5,
      });

      // Behavior pins.
      expect(res.action).toBe("updated");
      expect(res.comment.id).toBe(300);
      expect(res.cleaned).toHaveLength(2);
      expect(res.usedFullScan).toBe(depth >= 5);

      // Bound pins — INDEPENDENT of depth:
      //   list   : exactly 1 (single page)
      //   create : 0 (a match existed)
      //   update : 1 (newest update; older duplicates use remove)
      //   remove : 2 (the two older duplicates)
      expect(t.list).toHaveBeenCalledTimes(1);
      expect(t.create).toHaveBeenCalledTimes(0);
      expect(t.update).toHaveBeenCalledTimes(1);
      expect(t.remove).toHaveBeenCalledTimes(2);
    },
  );

  it("perf bound: even at depth=10000, completes well under a generous wall-clock budget", async () => {
    const t = makeApi([
      { id: 100, body: buryMarker(10_000) },
      { id: 200, body: buryMarker(10_000) },
      { id: 300, body: buryMarker(10_000) },
    ]);
    const t0 = performance.now();
    await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 5,
    });
    const elapsed = performance.now() - t0;
    // The scan is linear in body length but still trivial — we're just
    // pinning that there is no quadratic / re-scanning blowup.
    expect(elapsed).toBeLessThan(1000);
  });
});
