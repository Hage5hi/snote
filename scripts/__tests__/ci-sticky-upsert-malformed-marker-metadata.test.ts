// Integration: comments in the thread carry malformed sticky-marker
// metadata — missing id, non-numeric id, truncated marker, or extra
// junk inside the HTML comment. The matcher MUST only treat comments
// whose marker line equals the configured marker exactly (after trim)
// as matches. Malformed near-misses are left untouched, so cleanup
// converges the thread without ever touching unrelated comments.
import { describe, expect, it } from "vitest";
import {
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky id=42 -->";

function makeApi(initial: StickyComment[]) {
  const state = initial.map((c) => ({ ...c }));
  const removed: number[] = [];
  const api: StickyApi = {
    list: async () => state.map((c) => ({ ...c })),
    create: async (body) => {
      const c = { id: 9000, body };
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
      if (i >= 0) {
        state.splice(i, 1);
        removed.push(id);
      }
    },
  };
  return { api, state, removed };
}

describe("malformed sticky-marker metadata — cleanup skips invalid matches", () => {
  it("only exact-marker comments are selected/cleaned; near-miss markers are left intact", async () => {
    const malformed: StickyComment[] = [
      // Missing id=N entirely.
      { id: 1, body: `<!-- sticky -->\nlegacy bot comment` },
      // Non-numeric id.
      { id: 2, body: `<!-- sticky id=abc -->\nold experiment` },
      // Wrong numeric id (different sticky family).
      { id: 3, body: `<!-- sticky id=7 -->\nunrelated sticky` },
      // Truncated marker (missing trailing -->).
      { id: 4, body: `<!-- sticky id=42\ntruncated` },
      // Extra junk inside the comment.
      { id: 5, body: `<!-- sticky id=42 extra-junk -->\nclose-but-no` },
      // Exact valid markers — these are the only ones cleanup should touch.
      { id: 100, body: `${MARKER}\nolder real run` },
      { id: 200, body: `${MARKER}\nnewer real run (pre-update)` },
    ];
    const { api, state, removed } = makeApi(malformed);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh body",
    });

    // Newest valid match wins.
    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(200);

    // Exactly ONE older valid duplicate cleaned up.
    expect(res.cleaned).toEqual([{ id: 100, via: "delete" }]);
    expect(removed).toEqual([100]);

    // All malformed near-misses are still present, untouched.
    const survivingIds = state.map((c) => c.id).sort((a, b) => a - b);
    expect(survivingIds).toEqual([1, 2, 3, 4, 5, 200]);
    for (const id of [1, 2, 3, 4, 5]) {
      const original = malformed.find((c) => c.id === id)!.body;
      expect(state.find((c) => c.id === id)!.body).toBe(original);
    }
  });

  it("only malformed near-misses present → upsert creates a fresh marker comment, touches nothing", async () => {
    const malformed: StickyComment[] = [
      { id: 11, body: `<!-- sticky -->\nno id` },
      { id: 22, body: `<!-- sticky id=abc -->\nnon-numeric` },
      { id: 33, body: `<!-- sticky id=42\ntruncated` },
    ];
    const { api, state, removed } = makeApi(malformed);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "first real run",
    });

    expect(res.action).toBe("created");
    expect(res.cleaned).toEqual([]);
    expect(removed).toEqual([]);

    // Malformed comments are still present, bodies unchanged.
    for (const orig of malformed) {
      const live = state.find((c) => c.id === orig.id)!;
      expect(live.body).toBe(orig.body);
    }
    // Plus the freshly created marker comment.
    expect(state.some((c) => c.body.startsWith(MARKER))).toBe(true);
  });
});
