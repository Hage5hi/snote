// Integration: marker is buried PAST the default head-scan window.
//
// Scenario: a previous bot prepended ~20 lines of signature / build
// banner before the sticky marker. With the default headScanLines=5,
// the bounded head scan misses every duplicate and the upsert is
// forced to fall back to the full-body scanner (usedFullScan=true) to
// avoid creating yet another duplicate.
//
// When CI raises STICKY_HEAD_SCAN_LINES (e.g. to 30) to match the
// expected preamble depth, the head scan finds the matches directly
// (usedFullScan=false) AND cleanup still removes the older duplicates.
//
// This pins:
//   1. The full-scan fallback rescues the default config from creating
//      duplicates.
//   2. Tuning STICKY_HEAD_SCAN_LINES via parseCliConfig moves the work
//      onto the fast path while preserving the same cleanup outcome.
import { describe, expect, it } from "vitest";
import {
  MARKER_HEAD_SCAN_LINES,
  parseCliConfig,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:cli-coverage -->";

function buryMarker(depth: number, tail = "body content"): string {
  const preamble = Array.from({ length: depth }, (_, i) => `preamble line ${i + 1}`).join("\n");
  return `${preamble}\n${MARKER}\n${tail}`;
}

function makeApi(initial: StickyComment[]) {
  const state = new Map(initial.map((c) => [c.id, { ...c }]));
  const deleted: number[] = [];
  let nextId = Math.max(0, ...initial.map((c) => c.id)) + 1000;
  const api: StickyApi = {
    list: async () => Array.from(state.values()).map((c) => ({ ...c })),
    create: async (body) => {
      const c = { id: nextId++, body };
      state.set(c.id, c);
      return { ...c };
    },
    update: async (id, body) => {
      const c = state.get(id);
      if (!c) throw new Error(`no such comment ${id}`);
      c.body = body;
      return { ...c };
    },
    remove: async (id) => {
      state.delete(id);
      deleted.push(id);
    },
  };
  return { api, state, deleted };
}

describe("integration: marker beyond default head-scan window", () => {
  const BURY_DEPTH = 20; // well past the default 5-line head scan

  it("default headScanLines (5) misses head but full-scan fallback rescues; no duplicate created", async () => {
    expect(BURY_DEPTH).toBeGreaterThan(MARKER_HEAD_SCAN_LINES);
    const initial: StickyComment[] = [
      { id: 100, body: buryMarker(BURY_DEPTH, "older run") },
      { id: 200, body: buryMarker(BURY_DEPTH, "older run 2") },
      { id: 300, body: buryMarker(BURY_DEPTH, "newest existing") },
    ];
    const { api, state, deleted } = makeApi(initial);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh run body",
      // headScanLines omitted → default 5
    });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(300); // newest wins
    expect(res.usedFullScan).toBe(true); // head scan found nothing
    expect(res.cleaned.map((c) => c.id).sort()).toEqual([100, 200]);
    expect(deleted.sort()).toEqual([100, 200]);
    // Thread converged to exactly one live marker comment.
    expect(state.size).toBe(1);
    expect(state.get(300)!.body).toContain("fresh run body");
    expect(state.get(300)!.body).toContain(MARKER);
  });

  it("raising STICKY_HEAD_SCAN_LINES via env finds matches on the fast path AND still cleans up", async () => {
    const cfg = parseCliConfig([], { STICKY_HEAD_SCAN_LINES: "30" });
    expect(cfg.headScanLines).toBe(30);

    const initial: StickyComment[] = [
      { id: 11, body: buryMarker(BURY_DEPTH, "older A") },
      { id: 22, body: buryMarker(BURY_DEPTH, "older B") },
      { id: 33, body: buryMarker(BURY_DEPTH, "newest existing") },
    ];
    const { api, state, deleted } = makeApi(initial);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh body — head scan path",
      headScanLines: cfg.headScanLines,
      cleanupStrategy: cfg.cleanupStrategy,
    });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(33);
    expect(res.usedFullScan).toBe(false); // found on fast path
    expect(res.cleaned.map((c) => c.id).sort()).toEqual([11, 22]);
    expect(deleted.sort()).toEqual([11, 22]);
    expect(state.size).toBe(1);
    expect(state.get(33)!.body).toContain("fresh body — head scan path");
  });

  it("flag --head-scan-lines overrides the env var and reaches the deep marker on the fast path", async () => {
    const cfg = parseCliConfig(
      ["--head-scan-lines", "40"],
      { STICKY_HEAD_SCAN_LINES: "5" },
    );
    expect(cfg.headScanLines).toBe(40);

    const initial: StickyComment[] = [
      { id: 1, body: buryMarker(BURY_DEPTH) },
      { id: 2, body: buryMarker(BURY_DEPTH) },
    ];
    const { api, deleted } = makeApi(initial);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "x",
      headScanLines: cfg.headScanLines,
    });

    expect(res.usedFullScan).toBe(false);
    expect(res.comment.id).toBe(2);
    expect(deleted).toEqual([1]);
  });

  it("debug logger reports newest selection AND each cleanup action", async () => {
    const initial: StickyComment[] = [
      { id: 50, body: buryMarker(BURY_DEPTH) },
      { id: 60, body: buryMarker(BURY_DEPTH) },
      { id: 70, body: buryMarker(BURY_DEPTH) },
    ];
    const { api } = makeApi(initial);
    const lines: string[] = [];

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "x",
      headScanLines: 30,
      debug: (l) => lines.push(l),
    });

    expect(res.comment.id).toBe(70);
    const joined = lines.join("\n");
    expect(joined).toMatch(/selected newest sticky comment id=70/);
    expect(joined).toMatch(/deleted older duplicate sticky comment id=50/);
    expect(joined).toMatch(/deleted older duplicate sticky comment id=60/);
  });
});
