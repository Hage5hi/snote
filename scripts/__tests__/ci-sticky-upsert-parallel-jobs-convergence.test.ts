// Integration: two CI upsert jobs running in parallel with the SAME
// inputs against the SAME PR thread. The contract under racing:
//   - intermediate state may briefly contain duplicates (both jobs
//     observed an empty thread at list-time and both created)
//   - a SUBSEQUENT upsert (which is exactly what the next CI run does)
//     MUST converge the thread to a single sticky marker comment
//
// We simulate that contract by running 2 parallel upserts against a
// shared, atomic-per-op in-memory API, then running one more upsert
// and asserting the thread is fully converged.
import { describe, expect, it, vi } from "vitest";
import {
  hasStickyMarker,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky-test-marker -->";

function makeSharedApi(seed: StickyComment[] = []) {
  const state = seed.map((c) => ({ ...c }));
  let nextId = state.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  // Yield a microtask before+after each op so the two parallel jobs
  // genuinely interleave.
  const yieldTick = () => new Promise<void>((r) => setTimeout(r, 0));
  const api: StickyApi = {
    list: async () => {
      await yieldTick();
      return state.map((c) => ({ ...c }));
    },
    create: vi.fn(async (body: string) => {
      await yieldTick();
      const c = { id: nextId++, body };
      state.push(c);
      return { ...c };
    }),
    update: vi.fn(async (id: number, body: string) => {
      await yieldTick();
      const c = state.find((x) => x.id === id);
      if (!c) throw new Error(`update: ${id} not found`);
      c.body = body;
      return { ...c };
    }),
    remove: vi.fn(async (id: number) => {
      await yieldTick();
      const i = state.findIndex((x) => x.id === id);
      if (i >= 0) state.splice(i, 1);
    }),
  };
  return { api, state };
}

function countMarkers(state: StickyComment[]): number {
  return state.filter((c) => hasStickyMarker(c.body, MARKER, { fullScan: true })).length;
}

describe("parallel CI upserts converge to a single sticky comment", () => {
  it("two parallel jobs + one follow-up upsert → exactly ONE marker comment survives", async () => {
    const { api, state } = makeSharedApi([]);
    const body = "shared CI body";

    // Both jobs start at the same instant against an empty thread.
    await Promise.all([
      upsertStickyComment({ api, marker: MARKER, body }),
      upsertStickyComment({ api, marker: MARKER, body }),
    ]);

    // Intermediate state MAY have duplicates depending on interleaving.
    expect(countMarkers(state)).toBeGreaterThanOrEqual(1);

    // The very next CI run is what enforces convergence — that's the
    // documented contract (cleanup is best-effort per-run, monotonically
    // convergent across runs).
    const follow = await upsertStickyComment({ api, marker: MARKER, body });

    // Thread now has exactly ONE marker comment.
    expect(countMarkers(state)).toBe(1);
    // The surviving sticky is the one the follow-up updated.
    const survivors = state.filter((c) =>
      hasStickyMarker(c.body, MARKER, { fullScan: true }),
    );
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(follow.comment.id);
    // Body reflects the latest content.
    expect(survivors[0].body).toContain(body);
  });

  it("parallel jobs against a thread that ALREADY has duplicates → follow-up converges to one", async () => {
    const { api, state } = makeSharedApi([
      { id: 100, body: `${MARKER}\nstale 1` },
      { id: 200, body: `${MARKER}\nstale 2` },
      { id: 300, body: `${MARKER}\nstale 3` },
    ]);

    await Promise.all([
      upsertStickyComment({ api, marker: MARKER, body: "race A" }),
      upsertStickyComment({ api, marker: MARKER, body: "race B" }),
    ]);
    const follow = await upsertStickyComment({ api, marker: MARKER, body: "final" });

    expect(countMarkers(state)).toBe(1);
    const survivor = state.find((c) =>
      hasStickyMarker(c.body, MARKER, { fullScan: true }),
    )!;
    expect(survivor.id).toBe(follow.comment.id);
    expect(survivor.body).toContain("final");
    // None of the original stale-marker ids survive with a marker.
    // None of the original stale ids survive with a marker, EXCEPT
    // possibly the one that became the newest (it would have been
    // updated in place with the fresh body, which is the desired
    // converged state).
    for (const staleId of [100, 200, 300]) {
      if (staleId === follow.comment.id) continue;
      const c = state.find((x) => x.id === staleId);
      if (c) expect(hasStickyMarker(c.body, MARKER, { fullScan: true })).toBe(false);
    }
  });

  it("five parallel jobs racing → follow-up converges to one (stress)", async () => {
    const { api, state } = makeSharedApi([]);
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        upsertStickyComment({ api, marker: MARKER, body: `job ${i}` }),
      ),
    );
    await upsertStickyComment({ api, marker: MARKER, body: "final" });
    expect(countMarkers(state)).toBe(1);
  });
});
