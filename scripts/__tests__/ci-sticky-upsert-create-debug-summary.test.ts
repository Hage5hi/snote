// Integration: when no sticky marker comment exists in the thread, the
// upsert should CREATE a new comment and the debug output should:
//   - report the created comment id
//   - report zero cleanup actions
//   - emit a final summary line with cleaned=0
import { describe, expect, it } from "vitest";
import { upsertStickyComment, type StickyApi } from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky-test-marker -->";

function makeApi(initial: { id: number; body: string }[]): {
  api: StickyApi;
  state: { id: number; body: string }[];
  nextId: number;
  removed: number[];
} {
  const state = [...initial];
  const ctx = { nextId: 9000, removed: [] as number[] };
  const api: StickyApi = {
    list: async () => state.map((c) => ({ ...c })),
    create: async (body) => {
      const c = { id: ++ctx.nextId, body };
      state.push(c);
      return c;
    },
    update: async (id, body) => {
      const c = state.find((x) => x.id === id)!;
      c.body = body;
      return { ...c };
    },
    remove: async (id) => {
      ctx.removed.push(id);
      const i = state.findIndex((x) => x.id === id);
      if (i >= 0) state.splice(i, 1);
    },
  };
  return { api, state, nextId: ctx.nextId, removed: ctx.removed };
}

describe("upsertStickyComment — no existing marker → create + debug summary", () => {
  it("creates the comment and debug log reports new id with zero cleanup", async () => {
    const { api } = makeApi([
      { id: 1, body: "unrelated review comment" },
      { id: 2, body: "another reviewer's note" },
    ]);

    const lines: string[] = [];
    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "## fresh coverage report\n\nartifact: abc",
      debug: (l) => lines.push(l),
    });

    expect(res.action).toBe("created");
    expect(res.cleaned).toEqual([]);
    expect(res.usedFullScan).toBe(false);
    expect(res.comment.body.startsWith(MARKER)).toBe(true);

    const log = lines.join("\n");
    // Reports the newly created comment id.
    expect(log).toMatch(new RegExp(`created id=${res.comment.id}\\b`));
    // Reports it scanned the existing (non-matching) comments.
    expect(log).toMatch(/no existing marker found across 2 comment\(s\)/);
    // No cleanup actions logged.
    expect(log).not.toMatch(/deleted older duplicate/);
    expect(log).not.toMatch(/tombstoned older duplicate/);
    // Final summary line with cleaned=0 + both counters zero.
    expect(log).toMatch(
      new RegExp(
        `summary: action=created id=${res.comment.id} cleaned=0 \\(deleted=0 tombstoned=0\\)`,
      ),
    );
  });

  it("empty thread: still creates + summary line shows zero cleanup", async () => {
    const { api } = makeApi([]);
    const lines: string[] = [];
    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "first run",
      debug: (l) => lines.push(l),
    });

    expect(res.action).toBe("created");
    expect(res.cleaned).toHaveLength(0);
    const log = lines.join("\n");
    expect(log).toMatch(/no existing marker found across 0 comment\(s\)/);
    expect(log).toMatch(
      new RegExp(`summary: action=created id=${res.comment.id} cleaned=0`),
    );
  });
});
