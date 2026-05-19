// Integration: cleanupStrategy="delete" requested, but the API client
// has no `remove` capability. The upsert MUST silently fall back to
// "lock" (tombstoning) so the thread still converges, and the debug
// summary MUST report requestedStrategy=delete effectiveStrategy=lock.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOMBSTONE,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky-test-marker -->";

function makeApiNoRemove(initial: StickyComment[]) {
  const state = initial.map((c) => ({ ...c }));
  const api: StickyApi = {
    list: async () => state.map((c) => ({ ...c })),
    create: async (body) => {
      const c = { id: 999999, body };
      state.push(c);
      return c;
    },
    update: async (id, body) => {
      const c = state.find((x) => x.id === id)!;
      c.body = body;
      return { ...c };
    },
    // NOTE: deliberately omitting `remove` — simulates a bot identity
    // without delete permission on issue comments.
  };
  return { api, state };
}

describe("cleanupStrategy=delete with no api.remove → silent fallback to lock", () => {
  it("older duplicates are tombstoned (not deleted), debug shows the downgrade", async () => {
    const { api, state } = makeApiNoRemove([
      { id: 100, body: `${MARKER}\noldest` },
      { id: 200, body: `${MARKER}\nmiddle` },
      { id: 300, body: `${MARKER}\nnewest pre-update` },
    ]);

    const lines: string[] = [];
    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "fresh body",
      cleanupStrategy: "delete",
      debug: (l) => lines.push(l),
    });

    // Newest wins on update.
    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(300);

    // No state entries were removed (api can't delete) — all 3 still present.
    expect(state.map((c) => c.id).sort()).toEqual([100, 200, 300]);

    // Older two were tombstoned.
    expect(state.find((c) => c.id === 100)!.body).toBe(DEFAULT_TOMBSTONE);
    expect(state.find((c) => c.id === 200)!.body).toBe(DEFAULT_TOMBSTONE);

    // cleaned[] reflects via=lock for both, despite strategy="delete" requested.
    expect(res.cleaned).toHaveLength(2);
    expect(res.cleaned.every((c) => c.via === "lock")).toBe(true);

    // Debug: per-duplicate "tombstoned" lines + downgrade + final summary.
    const log = lines.join("\n");
    expect(log).toMatch(/tombstoned older duplicate sticky comment id=100/);
    expect(log).toMatch(/tombstoned older duplicate sticky comment id=200/);
    expect(log).not.toMatch(/deleted older duplicate/);
    expect(log).toMatch(
      /cleanup strategy=lock \(requested delete, fell back to lock\)/,
    );
    expect(log).toMatch(
      /summary: action=updated id=300 cleaned=2 \(deleted=0 tombstoned=2\) requestedStrategy=delete effectiveStrategy=lock/,
    );
  });
});
