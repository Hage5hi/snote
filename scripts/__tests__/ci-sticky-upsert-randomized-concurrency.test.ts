// Concurrency: many parallel upsertStickyComment calls with randomized
// interleavings (variable latency on list/create/update/remove) MUST
// converge — at most one newest marker comment survives after a final
// resync upsert, with all older marker bodies cleaned up.
//
// We don't try to prove serial-during-the-race semantics (the "list →
// decide → write" window is intentionally racy). The contract is: the
// NEXT upsert always converges the thread, regardless of how chaotic
// the racing writes were.
import { describe, expect, it, vi } from "vitest";
import {
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:random-interleaving -->";

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRacyApi(rng: () => number, seed: StickyComment[]) {
  const state = seed.map((c) => ({ ...c }));
  let nextId = state.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  // Random microtask jitter — yield 0..3 times before applying.
  const jitter = async () => {
    const n = Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) await Promise.resolve();
  };
  const api: StickyApi = {
    list: vi.fn(async () => {
      await jitter();
      return state.map((c) => ({ ...c }));
    }),
    create: vi.fn(async (body: string) => {
      await jitter();
      const c = { id: nextId++, body };
      state.push(c);
      return { ...c };
    }),
    update: vi.fn(async (id: number, body: string) => {
      await jitter();
      const c = state.find((x) => x.id === id);
      if (!c) throw new Error(`update: ${id} missing`);
      c.body = body;
      return { ...c };
    }),
    remove: vi.fn(async (id: number) => {
      await jitter();
      const i = state.findIndex((x) => x.id === id);
      if (i >= 0) state.splice(i, 1);
    }),
  };
  return { api, state };
}

describe("randomized concurrent upserts converge to a single newest marker", () => {
  it.each([
    ["seed=A, N=8, empty thread", 0xA1, 8, [] as StickyComment[]],
    ["seed=B, N=12, empty thread", 0xB2, 12, [] as StickyComment[]],
    ["seed=C, N=6, pre-existing duplicates", 0xC3, 6, [
      { id: 1, body: `${MARKER}\nstale-1` },
      { id: 2, body: `${MARKER}\nstale-2` },
      { id: 3, body: `${MARKER}\nstale-3` },
    ] as StickyComment[]],
    ["seed=D, N=16, pre-existing duplicates", 0xD4, 16, [
      { id: 1, body: `${MARKER}\nstale-1` },
      { id: 2, body: `${MARKER}\nstale-2` },
    ] as StickyComment[]],
  ])("%s → exactly one sticky survives after resync", async (_label, seed, N, initial) => {
    const rng = mulberry32(seed);
    const t = makeRacyApi(rng, initial);

    // Fire N upserts in parallel with distinct bodies.
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        upsertStickyComment({ api: t.api, marker: MARKER, body: `race-${i}` }),
      ),
    );

    // Convergence contract: the next upsert cleans up whatever the race
    // left behind.
    const resync = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "converged",
    });

    const sticky = t.state.filter((c) => c.body.includes(MARKER));
    expect(sticky, `seed=${seed} N=${N}`).toHaveLength(1);
    expect(sticky[0].id).toBe(resync.comment.id);
    expect(sticky[0].body).toContain("converged");
    // No racing body content survives in the final sticky.
    for (let i = 0; i < N; i++) {
      expect(sticky[0].body).not.toContain(`race-${i}`);
    }
  });

  it("repeated resync runs after a race are idempotent (no further writes)", async () => {
    const rng = mulberry32(0xFADE);
    const t = makeRacyApi(rng, []);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        upsertStickyComment({ api: t.api, marker: MARKER, body: `r${i}` }),
      ),
    );
    const first = await upsertStickyComment({ api: t.api, marker: MARKER, body: "settled" });

    // Snapshot post-resync state.
    const before = t.state.map((c) => ({ ...c }));

    // Two more resyncs with identical body → updated in place, no new
    // comments, no removes (nothing older to clean).
    const a = await upsertStickyComment({ api: t.api, marker: MARKER, body: "settled" });
    const b = await upsertStickyComment({ api: t.api, marker: MARKER, body: "settled" });
    expect(a.action).toBe("updated");
    expect(b.action).toBe("updated");
    expect(a.comment.id).toBe(first.comment.id);
    expect(b.comment.id).toBe(first.comment.id);
    expect(a.cleaned).toHaveLength(0);
    expect(b.cleaned).toHaveLength(0);
    // State unchanged.
    expect(t.state.map((c) => ({ ...c }))).toEqual(before);
  });
});
