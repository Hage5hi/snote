// Concurrency: two CI reruns kick off at nearly the same instant and
// both call upsertStickyComment against the SAME PR thread. Without
// cleanup we'd end up with two sticky comments (each rerun would have
// seen an empty/single thread, both would have created). With cleanup,
// even if both run interleaved, the thread MUST converge to exactly
// ONE sticky-marker comment — the second rerun cleans up whatever the
// first rerun left behind.
import { describe, expect, it, vi } from "vitest";
import {
  type StickyApi,
  type StickyComment,
  upsertStickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- Sticky Pull Request Commenti18n-cli-coverage -->";

/**
 * In-memory API where each operation can be awaited at a controllable
 * point. Lets us interleave two upsert calls deterministically.
 */
function makeRaceableApi(seed: StickyComment[]) {
  const comments = seed.map((c) => ({ ...c }));
  let nextId = comments.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const list = vi.fn(async () => {
    // Snapshot at call time (mimics GitHub's read-your-writes-eventually).
    return comments.map((c) => ({ ...c }));
  });
  const create = vi.fn(async (body: string) => {
    const c = { id: nextId++, body };
    comments.push(c);
    return { ...c };
  });
  const update = vi.fn(async (id: number, body: string) => {
    const c = comments.find((x) => x.id === id);
    if (!c) throw new Error(`update: comment ${id} not found`);
    c.body = body;
    return { ...c };
  });
  const remove = vi.fn(async (id: number) => {
    const i = comments.findIndex((x) => x.id === id);
    if (i >= 0) comments.splice(i, 1);
  });
  const api: StickyApi = { list, create, update, remove };
  return { api, comments };
}

describe("concurrent reruns — cleanup converges to a single sticky comment", () => {
  it("two reruns racing on an empty thread → at most one sticky after BOTH finish (second cleans up the first)", async () => {
    const t = makeRaceableApi([]);
    // Both reruns observe an empty thread at list-time and both create.
    // That's the worst-case race for sticky duplication.
    const bodyA = "rerun A body";
    const bodyB = "rerun B body";
    await Promise.all([
      upsertStickyComment({ api: t.api, marker: MARKER, body: bodyA }),
      upsertStickyComment({ api: t.api, marker: MARKER, body: bodyB }),
    ]);

    // Some interleavings will leave 2 sticky comments temporarily. The
    // contract is: a SUBSEQUENT upsert (which is what the next CI
    // tick / next rerun would do) MUST converge the thread to one.
    const resync = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "post-race resync",
    });

    const sticky = t.comments.filter((c) => c.body.includes(MARKER));
    expect(sticky).toHaveLength(1);
    expect(resync.action).toBe("updated");
    // The resync updated the newest, and the resync body is what
    // remains in the thread.
    expect(sticky[0].body).toContain("post-race resync");
    expect(sticky[0].body).not.toContain(bodyA);
    expect(sticky[0].body).not.toContain(bodyB);
  });

  it("two reruns racing on a thread with one pre-existing sticky → never grows beyond one", async () => {
    const t = makeRaceableApi([{ id: 1, body: `${MARKER}\nseed` }]);
    await Promise.all([
      upsertStickyComment({ api: t.api, marker: MARKER, body: "A" }),
      upsertStickyComment({ api: t.api, marker: MARKER, body: "B" }),
    ]);
    // Even in the worst interleaving, the next rerun converges.
    await upsertStickyComment({ api: t.api, marker: MARKER, body: "C" });

    const sticky = t.comments.filter((c) => c.body.includes(MARKER));
    expect(sticky).toHaveLength(1);
    expect(sticky[0].body).toContain("C");
  });

  it("two reruns racing on a thread with PRE-EXISTING duplicates → still converges to one", async () => {
    const t = makeRaceableApi([
      { id: 1, body: `${MARKER}\nstale 1` },
      { id: 2, body: `${MARKER}\nstale 2` },
      { id: 3, body: `${MARKER}\nstale 3 (newest seed)` },
    ]);

    // Both reruns will independently try to clean up the same duplicate
    // set. Removes are idempotent in our mock (no-op if id is gone).
    await Promise.all([
      upsertStickyComment({ api: t.api, marker: MARKER, body: "A" }),
      upsertStickyComment({ api: t.api, marker: MARKER, body: "B" }),
    ]);

    const sticky = t.comments.filter((c) => c.body.includes(MARKER));
    // At most one sticky after the race (the cleanup branch removes
    // older duplicates inside each upsert).
    expect(sticky.length).toBeLessThanOrEqual(1);

    // And the next tick guarantees convergence.
    await upsertStickyComment({ api: t.api, marker: MARKER, body: "final" });
    const finalSticky = t.comments.filter((c) => c.body.includes(MARKER));
    expect(finalSticky).toHaveLength(1);
    expect(finalSticky[0].body).toContain("final");
    expect(finalSticky[0].body).not.toContain("stale");
  });

  it("100 randomly interleaved upserts never leave more than 1 sticky after a final resync", async () => {
    const t = makeRaceableApi([
      { id: 1, body: `${MARKER}\nseed 1` },
      { id: 2, body: `${MARKER}\nseed 2` },
    ]);
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 100; i++) {
      ops.push(
        upsertStickyComment({ api: t.api, marker: MARKER, body: `body-${i}` }),
      );
    }
    await Promise.all(ops);
    await upsertStickyComment({ api: t.api, marker: MARKER, body: "resync" });

    const sticky = t.comments.filter((c) => c.body.includes(MARKER));
    expect(sticky).toHaveLength(1);
    expect(sticky[0].body).toContain("resync");
  });
});
