// Integration: with cleanupStrategy="lock", older duplicate marker
// comments must be TOMBSTONED (body rewritten, marker removed) rather
// than deleted, even when the API supports remove. Verifies:
//   - newest comment id (highest id) is the one updated with fresh body
//   - older duplicates have their bodies overwritten
//   - api.remove is never called
//   - returned `cleaned` entries all carry via="lock"
//   - final debug summary reports tombstoned=N deleted=0 + effectiveStrategy=lock
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOMBSTONE,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky-test-marker -->";

function makeApi(initial: StickyComment[]) {
  const state = initial.map((c) => ({ ...c }));
  const removed: number[] = [];
  const updates: { id: number; body: string }[] = [];
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
      updates.push({ id, body });
      return { ...c };
    },
    remove: async (id) => {
      removed.push(id);
    },
  };
  return { api, state, removed, updates };
}

describe("upsertStickyComment — cleanupStrategy=lock tombstones duplicates", () => {
  it("older duplicates are rewritten to tombstone, never deleted", async () => {
    const { api, state, removed, updates } = makeApi([
      { id: 100, body: `${MARKER}\noldest run` },
      { id: 200, body: `${MARKER}\nmiddle run` },
      { id: 300, body: `${MARKER}\nnewest run (pre-update)` },
    ]);

    const lines: string[] = [];
    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "## fresh body",
      cleanupStrategy: "lock",
      debug: (l) => lines.push(l),
    });

    // Newest (highest id) wins.
    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(300);
    expect(res.comment.body).toContain("## fresh body");
    expect(res.comment.body.startsWith(MARKER)).toBe(true);

    // No deletes ever happened.
    expect(removed).toEqual([]);

    // Older duplicates have tombstone bodies — marker is gone.
    const c100 = state.find((c) => c.id === 100)!;
    const c200 = state.find((c) => c.id === 200)!;
    expect(c100.body).toBe(DEFAULT_TOMBSTONE);
    expect(c200.body).toBe(DEFAULT_TOMBSTONE);
    expect(c100.body).not.toContain(MARKER);
    expect(c200.body).not.toContain(MARKER);

    // cleaned[] all via=lock.
    expect(res.cleaned).toHaveLength(2);
    expect(res.cleaned.every((c) => c.via === "lock")).toBe(true);
    expect(res.cleaned.map((c) => c.id).sort()).toEqual([100, 200]);

    // Updates: newest got fresh body, old got tombstone.
    expect(updates.find((u) => u.id === 300)?.body).toContain("## fresh body");
    expect(updates.find((u) => u.id === 100)?.body).toBe(DEFAULT_TOMBSTONE);
    expect(updates.find((u) => u.id === 200)?.body).toBe(DEFAULT_TOMBSTONE);

    // Debug log: per-duplicate + final summary.
    const log = lines.join("\n");
    expect(log).toMatch(/tombstoned older duplicate sticky comment id=100/);
    expect(log).toMatch(/tombstoned older duplicate sticky comment id=200/);
    expect(log).not.toMatch(/deleted older duplicate/);
    expect(log).toMatch(
      /summary: action=updated id=300 cleaned=2 \(deleted=0 tombstoned=2\) requestedStrategy=lock effectiveStrategy=lock/,
    );
  });

  it("rerun after lock: tombstones do NOT match marker → newest still wins, no new duplicates", async () => {
    const { api, state, removed } = makeApi([
      { id: 100, body: DEFAULT_TOMBSTONE },
      { id: 200, body: DEFAULT_TOMBSTONE },
      { id: 300, body: `${MARKER}\nlast surviving sticky` },
    ]);

    const res = await upsertStickyComment({
      api,
      marker: MARKER,
      body: "rerun body",
      cleanupStrategy: "lock",
    });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(300);
    expect(res.cleaned).toEqual([]);
    expect(removed).toEqual([]);
    // Tombstones untouched.
    expect(state.find((c) => c.id === 100)?.body).toBe(DEFAULT_TOMBSTONE);
    expect(state.find((c) => c.id === 200)?.body).toBe(DEFAULT_TOMBSTONE);
  });
});
