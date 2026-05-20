// Integration: idempotent rerun. When the upsert runs twice with the
// SAME body against the SAME thread, the second run is effectively a
// no-op from a content perspective (the body it would write equals
// what is already there) and `scanStats` is identical across runs.
//
// We don't require the implementation to skip the update API call —
// GitHub's PATCH is idempotent and adding a "skip if equal" branch is
// out of scope — but we DO require:
//   - second run is `updated` (not `created`)
//   - second run targets the SAME comment id
//   - second run does NOT clean anything (no new duplicates emerged)
//   - scanStats matches the first run exactly
import { describe, expect, it, vi } from "vitest";
import {
  type StickyApi,
  type StickyComment,
  upsertStickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:idempotent-rerun -->";

function makeApi(seed: StickyComment[]) {
  const comments = seed.map((c) => ({ ...c }));
  let nextId = comments.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const api: StickyApi = {
    list: vi.fn(async () => comments.map((c) => ({ ...c }))),
    create: vi.fn(async (body: string) => {
      const c = { id: nextId++, body };
      comments.push(c);
      return { ...c };
    }),
    update: vi.fn(async (id: number, body: string) => {
      const c = comments.find((x) => x.id === id)!;
      c.body = body;
      return { ...c };
    }),
    remove: vi.fn(async (id: number) => {
      const i = comments.findIndex((x) => x.id === id);
      if (i >= 0) comments.splice(i, 1);
    }),
  };
  return { api, comments };
}

describe("upsert is idempotent across reruns with identical body", () => {
  it("second run with same body → updated, no cleanup, scanStats matches first run", async () => {
    const t = makeApi([{ id: 11, body: `${MARKER}\nseed` }]);
    const body = "the same body across both runs";

    const r1 = await upsertStickyComment({ api: t.api, marker: MARKER, body });
    const r2 = await upsertStickyComment({ api: t.api, marker: MARKER, body });

    expect(r1.action).toBe("updated");
    expect(r2.action).toBe("updated");
    expect(r2.comment.id).toBe(r1.comment.id);
    expect(r2.cleaned).toEqual([]);

    // scanStats stable across runs: same thread shape, same scan budget.
    expect(r2.scanStats).toEqual(r1.scanStats);
    expect(r2.scanStats.commentsExamined).toBe(1);
    expect(r2.scanStats.pagesWalked).toBe(1);

    // Thread still has exactly one sticky.
    const sticky = t.comments.filter((c) => c.body.includes(MARKER));
    expect(sticky).toHaveLength(1);
  });

  it("third run after second still no-ops and scanStats remain consistent", async () => {
    const t = makeApi([{ id: 4, body: `${MARKER}\nseed` }]);
    const body = "stable body";
    const r1 = await upsertStickyComment({ api: t.api, marker: MARKER, body });
    const r2 = await upsertStickyComment({ api: t.api, marker: MARKER, body });
    const r3 = await upsertStickyComment({ api: t.api, marker: MARKER, body });

    expect([r1, r2, r3].every((r) => r.action === "updated")).toBe(true);
    expect(new Set([r1.comment.id, r2.comment.id, r3.comment.id]).size).toBe(1);
    expect(r2.cleaned).toEqual([]);
    expect(r3.cleaned).toEqual([]);
    expect(r3.scanStats).toEqual(r1.scanStats);
    expect(r3.scanStats).toEqual(r2.scanStats);
  });
});
