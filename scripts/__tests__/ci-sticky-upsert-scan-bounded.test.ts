// Bounded-scan guarantees:
//
//   1. The head scan only ever inspects the first MARKER_HEAD_SCAN_LINES
//      lines of each comment body. A pathologically long body with the
//      marker buried deep (or absent) must NOT cause a per-line walk
//      during the fast path.
//
//   2. The full-scan fallback only runs when the head scan finds zero
//      matches across the entire thread — so a well-formed thread with
//      the marker near the top never pays the O(body) cost.
//
//   3. The API surface is bounded too: at most one create OR one
//      update for the newest match, plus one delete/update per stale
//      duplicate. No retries, no extra list calls.
//
// These bounds protect CI from a malicious or accidental megabyte
// comment that would otherwise blow our GitHub API budget every rerun.
import { describe, expect, it, vi } from "vitest";
import {
  hasStickyMarker,
  MARKER_HEAD_SCAN_LINES,
  type StickyApi,
  upsertStickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- Sticky Pull Request Commenti18n-cli-coverage -->";

describe("hasStickyMarker — bounded head scan", () => {
  it("default head-scan window is exposed and reasonable", () => {
    expect(MARKER_HEAD_SCAN_LINES).toBeGreaterThan(0);
    expect(MARKER_HEAD_SCAN_LINES).toBeLessThanOrEqual(10);
  });

  it("does NOT find a marker buried past the head window (head scan)", () => {
    const noise = "noise\n".repeat(MARKER_HEAD_SCAN_LINES + 50);
    const body = `${noise}${MARKER}\nrest`;
    expect(hasStickyMarker(body, MARKER)).toBe(false);
  });

  it("DOES find the same buried marker with { fullScan: true }", () => {
    const noise = "noise\n".repeat(MARKER_HEAD_SCAN_LINES + 50);
    const body = `${noise}${MARKER}\nrest`;
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(true);
  });

  it("head scan is O(headScanLines): a 1MB single-line body returns fast", () => {
    // Single huge line means the head-scan still only inspects 1 line
    // total (no \n to split on past the head window). Without bounding
    // by lines we'd be safe; the perf bound is really about a body
    // with MANY lines — covered below.
    const huge = "x".repeat(1_000_000);
    const t0 = performance.now();
    const result = hasStickyMarker(huge, MARKER);
    const elapsed = performance.now() - t0;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(250);
  });

  it("head scan ignores lines past the window even in a many-line body", () => {
    const body = `${"noise\n".repeat(5_000)}${MARKER}\nrest`;
    expect(hasStickyMarker(body, MARKER)).toBe(false);
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(true);
  });

  it("custom headScanLines is respected", () => {
    const body = `a\nb\nc\n${MARKER}\nrest`;
    expect(hasStickyMarker(body, MARKER, { headScanLines: 2 })).toBe(false);
    expect(hasStickyMarker(body, MARKER, { headScanLines: 4 })).toBe(true);
  });
});

describe("upsertStickyComment — bounded API calls", () => {
  function makeApi(seed: { id: number; body: string }[]) {
    const comments = seed.map((c) => ({ ...c }));
    const list = vi.fn(async () => comments.map((c) => ({ ...c })));
    const create = vi.fn(async (body: string) => {
      const c = { id: 999, body: `${MARKER}\n${body}` };
      comments.push(c);
      return { ...c };
    });
    const update = vi.fn(async (id: number, body: string) => {
      const c = comments.find((x) => x.id === id)!;
      c.body = body;
      return { ...c };
    });
    const remove = vi.fn(async (id: number) => {
      const i = comments.findIndex((x) => x.id === id);
      if (i >= 0) comments.splice(i, 1);
    });
    const api: StickyApi = { list, create, update, remove };
    return { api, list, create, update, remove };
  }

  it("happy path: exactly 1 list + 1 update, no full scan, no extra API calls", async () => {
    const t = makeApi([{ id: 1, body: `${MARKER}\nold` }]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "new" });
    expect(t.list).toHaveBeenCalledTimes(1);
    expect(t.update).toHaveBeenCalledTimes(1);
    expect(t.create).not.toHaveBeenCalled();
    expect(t.remove).not.toHaveBeenCalled();
    expect(res.usedFullScan).toBe(false);
  });

  it("no marker anywhere: 1 list + 1 create, no update/remove (full scan ran but found nothing)", async () => {
    const t = makeApi([
      { id: 1, body: "huge unrelated body\n".repeat(50) },
      { id: 2, body: "another unrelated comment" },
    ]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });
    expect(t.list).toHaveBeenCalledTimes(1);
    expect(t.create).toHaveBeenCalledTimes(1);
    expect(t.update).not.toHaveBeenCalled();
    expect(t.remove).not.toHaveBeenCalled();
    expect(res.usedFullScan).toBe(false);
  });

  it("deeply buried marker triggers fullScan fallback exactly ONCE per upsert", async () => {
    const buried = `${"prelude\n".repeat(MARKER_HEAD_SCAN_LINES + 20)}${MARKER}\nbody`;
    const t = makeApi([{ id: 5, body: buried }]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "new" });
    expect(res.usedFullScan).toBe(true);
    expect(res.action).toBe("updated");
    expect(t.list).toHaveBeenCalledTimes(1);
    expect(t.update).toHaveBeenCalledTimes(1);
    expect(t.create).not.toHaveBeenCalled();
  });

  it("N duplicates → exactly 1 update + (N-1) removes, no creates, single list", async () => {
    const seed = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      body: `${MARKER}\nstale #${i}`,
    }));
    const t = makeApi(seed);
    await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });
    expect(t.list).toHaveBeenCalledTimes(1);
    expect(t.create).not.toHaveBeenCalled();
    expect(t.update).toHaveBeenCalledTimes(1); // only the newest
    expect(t.remove).toHaveBeenCalledTimes(5); // the 5 older duplicates
  });
});
