// Integration: two sequential upserts under cleanupStrategy="lock".
//
// Run #1 tombstones older duplicates (they no longer carry the marker).
// Run #2 must therefore see only the one surviving sticky marker
// comment (the one Run #1 updated), select it as newest, and perform
// NO further cleanup actions — tombstones from Run #1 are invisible to
// the matcher and must never be re-selected as the "newest" target.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOMBSTONE,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:lock-then-rerun -->";

function makeApi(initial: StickyComment[]) {
  const state = initial.map((c) => ({ ...c }));
  const api: StickyApi = {
    list: async () => state.map((c) => ({ ...c })),
    create: async (body) => {
      const c = { id: 9999, body };
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

describe("lock strategy → second run selects the only surviving non-tombstoned marker", () => {
  it("run 1 tombstones older duplicates; run 2 cleans nothing and updates the survivor", async () => {
    const { api, state } = makeApi([
      { id: 100, body: `${MARKER}\nrun 0 (oldest)` },
      { id: 200, body: `${MARKER}\nrun 0 (middle)` },
      { id: 300, body: `${MARKER}\nrun 0 (newest pre-update)` },
    ]);

    // Run #1 — lock strategy.
    const run1 = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "run 1 body",
      cleanupStrategy: "lock",
    });
    expect(run1.action).toBe("updated");
    expect(run1.comment.id).toBe(300);
    expect(run1.cleaned).toEqual([
      { id: 100, via: "lock" },
      { id: 200, via: "lock" },
    ]);

    // All three comments still exist (lock never deletes). Older two
    // are tombstoned (no marker), id=300 is the live sticky.
    expect(state.map((c) => c.id).sort((a, b) => a - b)).toEqual([100, 200, 300]);
    expect(state.find((c) => c.id === 100)!.body).toBe(DEFAULT_TOMBSTONE);
    expect(state.find((c) => c.id === 200)!.body).toBe(DEFAULT_TOMBSTONE);
    expect(state.find((c) => c.id === 300)!.body).toContain(MARKER);
    expect(state.find((c) => c.id === 300)!.body).toContain("run 1 body");

    // Run #2 — same marker, fresh body. Tombstones must be ignored.
    const run2 = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "run 2 body",
      cleanupStrategy: "lock",
    });

    // Selected the only surviving non-tombstoned sticky.
    expect(run2.action).toBe("updated");
    expect(run2.comment.id).toBe(300);
    // No further cleanup actions — tombstones don't match the marker.
    expect(run2.cleaned).toEqual([]);

    // Tombstones unchanged; live sticky updated with run 2 body.
    expect(state.find((c) => c.id === 100)!.body).toBe(DEFAULT_TOMBSTONE);
    expect(state.find((c) => c.id === 200)!.body).toBe(DEFAULT_TOMBSTONE);
    expect(state.find((c) => c.id === 300)!.body).toContain("run 2 body");
    expect(state.find((c) => c.id === 300)!.body).not.toContain("run 1 body");
  });

  it("custom tombstone body is also ignored by the second run's matcher", async () => {
    const TOMB = "<!-- custom-tombstone -->\nsuperseded";
    const { api, state } = makeApi([
      { id: 1, body: `${MARKER}\nA` },
      { id: 2, body: `${MARKER}\nB (newest)` },
    ]);

    await upsertStickyComment({
      api,
      marker: MARKER,
      body: "first",
      cleanupStrategy: "lock",
      tombstone: TOMB,
    });
    expect(state.find((c) => c.id === 1)!.body).toBe(TOMB);

    const run2 = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "second",
      cleanupStrategy: "lock",
      tombstone: TOMB,
    });
    expect(run2.comment.id).toBe(2);
    expect(run2.cleaned).toEqual([]);
    expect(state.find((c) => c.id === 1)!.body).toBe(TOMB);
    expect(state.find((c) => c.id === 2)!.body).toContain("second");
  });
});
