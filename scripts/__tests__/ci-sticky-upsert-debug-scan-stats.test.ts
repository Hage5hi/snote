// Pins the new scanStats debug lines:
//
//   - `head-scan: pagesWalked=N commentsExamined=N linesScanned=N
//      matches=N headScanLines=N`
//   - `full-scan fallback: pagesWalked=N commentsExamined=N
//      linesScanned=N matches=N engaged=true|false`
//
// Both lines must:
//   - be emitted when debug is enabled (true OR sink callback)
//   - include accurate scanStats counters
//   - be completely silent when debug is unset or false
//   - the full-scan line must ONLY appear when the head scan finds
//     zero matches (engaged=true OR engaged=false-but-no-head-match)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:debug-scan-stats -->";

function makeApi(seed: StickyComment[]) {
  const state = seed.map((c) => ({ ...c }));
  let nextId = state.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const api: StickyApi = {
    list: async () => state.map((c) => ({ ...c })),
    create: async (body) => {
      const c = { id: nextId++, body };
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
  return { api };
}

describe("debug output includes scanStats on head-match and full-scan paths", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  describe("debug enabled (sink callback)", () => {
    it("head-match path: emits head-scan line with stats, no full-scan line", async () => {
      const { api } = makeApi([
        { id: 1, body: `${MARKER}\nold` },
        { id: 2, body: `${MARKER}\nnewer` },
      ]);
      const lines: string[] = [];
      await upsertStickyComment({
        api,
        marker: MARKER,
        body: "fresh",
        debug: (l) => lines.push(l),
      });
      const head = lines.filter((l) => l.startsWith("head-scan:"));
      const full = lines.filter((l) => l.startsWith("full-scan fallback:"));
      expect(head).toHaveLength(1);
      expect(head[0]).toMatch(
        /head-scan: pagesWalked=1 commentsExamined=2 linesScanned=2 matches=2 headScanLines=5/,
      );
      expect(full).toHaveLength(0);
    });

    it("full-scan fallback path: emits BOTH head-scan and full-scan lines", async () => {
      const noise = Array.from({ length: 10 }, (_, i) => `n${i}`).join("\n");
      const { api } = makeApi([
        { id: 1, body: `${noise}\n${MARKER}\ntrailing` }, // marker on line 11
      ]);
      const lines: string[] = [];
      const res = await upsertStickyComment({
        api,
        marker: MARKER,
        body: "fresh",
        debug: (l) => lines.push(l),
      });
      const head = lines.filter((l) => l.startsWith("head-scan:"));
      const full = lines.filter((l) => l.startsWith("full-scan fallback:"));
      expect(head).toHaveLength(1);
      expect(head[0]).toMatch(/matches=0/);
      expect(full).toHaveLength(1);
      expect(full[0]).toMatch(/engaged=true/);
      expect(full[0]).toMatch(/matches=1/);
      expect(res.usedFullScan).toBe(true);
    });

    it("no match anywhere: full-scan line still emitted with engaged=false", async () => {
      const { api } = makeApi([{ id: 1, body: "no marker here" }]);
      const lines: string[] = [];
      await upsertStickyComment({
        api,
        marker: MARKER,
        body: "fresh",
        debug: (l) => lines.push(l),
      });
      expect(lines.filter((l) => l.startsWith("head-scan:"))).toHaveLength(1);
      const full = lines.filter((l) => l.startsWith("full-scan fallback:"));
      expect(full).toHaveLength(1);
      expect(full[0]).toMatch(/engaged=false/);
      expect(full[0]).toMatch(/matches=0/);
    });
  });

  describe("debug enabled (debug=true → console.log)", () => {
    it("head-scan line is written through console.log with [sticky-upsert] prefix", async () => {
      const { api } = makeApi([{ id: 1, body: `${MARKER}\nx` }]);
      await upsertStickyComment({ api, marker: MARKER, body: "fresh", debug: true });
      const all = logSpy.mock.calls.map((c) => String(c[0]));
      expect(all.some((l) => /^\[sticky-upsert\] head-scan:/.test(l))).toBe(true);
    });
  });

  describe("debug disabled", () => {
    it("debug=undefined → no head-scan or full-scan line, no console output at all", async () => {
      const { api } = makeApi([{ id: 1, body: `${MARKER}\nx` }]);
      const res = await upsertStickyComment({ api, marker: MARKER, body: "fresh" });
      expect(res.action).toBe("updated");
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("debug=false → no head-scan or full-scan line, even when fallback engages", async () => {
      const noise = Array.from({ length: 10 }, (_, i) => `n${i}`).join("\n");
      const { api } = makeApi([{ id: 1, body: `${noise}\n${MARKER}\ntail` }]);
      const res = await upsertStickyComment({
        api,
        marker: MARKER,
        body: "fresh",
        debug: false,
      });
      expect(res.usedFullScan).toBe(true);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("debug=false with sink-less call: no callback invocation possible (silent)", async () => {
      const { api } = makeApi([]);
      const captured: string[] = [];
      // No `debug` field at all → no sink to call. Just ensures the call
      // path doesn't throw and stays silent.
      await upsertStickyComment({ api, marker: MARKER, body: "fresh" });
      expect(captured).toEqual([]);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
