// Pins debug-gating of the final `summary:` line:
//   - emitted on the CREATED path only when debug is enabled
//   - emitted on the UPDATED path only when debug is enabled
//   - completely silent (no console output, no callback invocation)
//     when debug is unset / false
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky-test-marker -->";

function makeApi(initial: StickyComment[]) {
  const state = initial.map((c) => ({ ...c }));
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

describe("final debug summary line is gated by the debug option", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  describe("CREATED path", () => {
    it("debug=true → summary line is emitted (with cleaned=0)", async () => {
      const { api } = makeApi([]);
      const lines: string[] = [];
      await upsertStickyComment({
        api,
        marker: MARKER,
        body: "x",
        debug: (l) => lines.push(l),
      });
      const summary = lines.filter((l) => l.startsWith("summary:"));
      expect(summary).toHaveLength(1);
      expect(summary[0]).toMatch(/action=created id=\d+ cleaned=0 \(deleted=0 tombstoned=0\)/);
    });

    it("debug=undefined → no summary line, no console output at all", async () => {
      const { api } = makeApi([]);
      const res = await upsertStickyComment({ api, marker: MARKER, body: "x" });
      expect(res.action).toBe("created");
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("debug=false → no summary line, no console output at all", async () => {
      const { api } = makeApi([]);
      await upsertStickyComment({ api, marker: MARKER, body: "x", debug: false });
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("UPDATED path", () => {
    const seed = (): StickyComment[] => [
      { id: 100, body: `${MARKER}\nold` },
      { id: 200, body: `${MARKER}\nnewer` },
    ];

    it("debug=true → summary line is emitted (with cleaned=N + strategy)", async () => {
      const { api } = makeApi(seed());
      const lines: string[] = [];
      await upsertStickyComment({
        api,
        marker: MARKER,
        body: "x",
        debug: (l) => lines.push(l),
      });
      const summary = lines.filter((l) => l.startsWith("summary:"));
      expect(summary).toHaveLength(1);
      expect(summary[0]).toMatch(
        /action=updated id=200 cleaned=1 \(deleted=1 tombstoned=0\) requestedStrategy=delete effectiveStrategy=delete/,
      );
    });

    it("debug=undefined → no summary line, no console output at all", async () => {
      const { api } = makeApi(seed());
      const res = await upsertStickyComment({ api, marker: MARKER, body: "x" });
      expect(res.action).toBe("updated");
      expect(res.cleaned).toHaveLength(1);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("debug=false → no summary line, no console output at all", async () => {
      const { api } = makeApi(seed());
      await upsertStickyComment({ api, marker: MARKER, body: "x", debug: false });
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  it("debug=true with console sink: writes exactly one summary line through console.log", async () => {
    const { api } = makeApi([{ id: 100, body: `${MARKER}\nx` }]);
    await upsertStickyComment({ api, marker: MARKER, body: "fresh", debug: true });
    const allCalls = logSpy.mock.calls.map((c) => String(c[0]));
    const summary = allCalls.filter((l) => l.includes("summary:"));
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatch(/\[sticky-upsert\] summary: action=updated/);
  });
});
