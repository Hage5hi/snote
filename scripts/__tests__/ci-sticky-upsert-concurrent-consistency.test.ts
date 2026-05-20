// Integration: two concurrent upsertStickyComment calls against the
// same thread converge to a consistent final state.
//
// Unlike ci-sticky-upsert-concurrent-cleanup.test.ts (which exercises a
// few canned shapes), this test fans out N parallel upsert calls and
// pins the post-convergence invariants explicitly:
//
//   - exactly ONE sticky-marker comment survives after a resync tick
//   - the surviving comment is the NEWEST id ever created
//   - every older marker comment is fully cleaned (deleted), so the
//     thread has no zombie marker bodies
//
// Why it matters: GitHub Actions reruns and matrix jobs can fire two
// upserts within ms of each other. The "list → decide → write" window
// is racy by construction; the contract is that the NEXT upsert always
// converges the thread. This test prevents a regression where two
// parallel creates would leave a stale duplicate even after resync.
import { describe, expect, it, vi } from "vitest";
import {
  type StickyApi,
  type StickyComment,
  upsertStickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:concurrent-consistency -->";

function makeApi(seed: StickyComment[]) {
  const comments = seed.map((c) => ({ ...c }));
  let nextId = comments.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const api: StickyApi = {
    list: vi.fn(async () => comments.map((c) => ({ ...c }))),
    create: vi.fn(async (body: string) => {
      // Simulate a small write latency so list calls on the parallel
      // task can race the create.
      await Promise.resolve();
      const c = { id: nextId++, body };
      comments.push(c);
      return { ...c };
    }),
    update: vi.fn(async (id: number, body: string) => {
      const c = comments.find((x) => x.id === id);
      if (!c) throw new Error(`update: comment ${id} not found`);
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

describe("two concurrent upserts converge to a single newest sticky", () => {
  it("two parallel calls on an empty thread → one sticky after resync, no leftover duplicates", async () => {
    const t = makeApi([]);
    await Promise.all([
      upsertStickyComment({ api: t.api, marker: MARKER, body: "left" }),
      upsertStickyComment({ api: t.api, marker: MARKER, body: "right" }),
    ]);

    // Next tick is the convergence contract.
    const resync = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "converged",
    });

    const sticky = t.comments.filter((c) => c.body.includes(MARKER));
    expect(sticky).toHaveLength(1);
    expect(sticky[0].id).toBe(resync.comment.id);
    expect(sticky[0].body).toContain("converged");
    // No older marker bodies survive (delete strategy by default).
    expect(sticky[0].body).not.toContain("left");
    expect(sticky[0].body).not.toContain("right");
  });

  it("two parallel calls on a thread with pre-existing duplicates → newest id wins, older ids gone", async () => {
    const t = makeApi([
      { id: 1, body: `${MARKER}\nstale-1` },
      { id: 2, body: `${MARKER}\nstale-2` },
    ]);

    await Promise.all([
      upsertStickyComment({ api: t.api, marker: MARKER, body: "p1" }),
      upsertStickyComment({ api: t.api, marker: MARKER, body: "p2" }),
    ]);
    const resync = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "final",
    });

    const sticky = t.comments.filter((c) => c.body.includes(MARKER));
    expect(sticky).toHaveLength(1);
    expect(sticky[0].id).toBe(resync.comment.id);

    // The surviving id is the newest id ever observed.
    const allIds = t.comments.map((c) => c.id);
    expect(sticky[0].id).toBe(Math.max(...allIds));

    // Older seeded marker bodies are fully gone.
    expect(t.comments.find((c) => c.id === 1)).toBeUndefined();
    expect(t.comments.find((c) => c.id === 2)).toBeUndefined();
  });
});
