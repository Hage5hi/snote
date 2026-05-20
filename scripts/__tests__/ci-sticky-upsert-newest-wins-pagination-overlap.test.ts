// Integration: when multiple marker comments exist with non-monotonic
// arrival order (e.g. a manual paste landed AFTER an automated CI
// comment, or a long-running job's create finally settled), the upsert
// must pick the NEWEST by id — which is GitHub's monotonic ordering,
// equivalent to "most recently created" — regardless of how the API
// paginates and overlaps results.
//
// Two failure modes this guards against:
//   • Returning the FIRST-page newest instead of the GLOBAL newest
//     when a later page contains a higher id.
//   • Returning a duplicate id (GitHub can briefly serve overlapping
//     pages while comments are added during the walk) as if it were
//     two separate matches.
//
// Bodies also carry a synthetic ISO timestamp in their text so the
// scenarios document intent for a reader; only `id` actually drives
// the "newest" decision.
import { describe, expect, it } from "vitest";
import {
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
  type StickyListMeta,
} from "../ci-sticky-pr-comment-upsert";
import { summarizeScan } from "./_helpers/sticky-scan-summary";

const MARKER = "<!-- sticky:newest-wins-overlap -->";

function mk(id: number, isoTs: string, tag: string): StickyComment {
  return { id, body: `${MARKER}\nts=${isoTs} tag=${tag}` };
}

/** API whose pages may overlap (same comment id surfaces on >1 page). */
function makeOverlappingApi(pages: StickyComment[][]) {
  // Deduplicate state by id for the underlying mutations.
  const byId = new Map<number, StickyComment>();
  for (const p of pages) for (const c of p) byId.set(c.id, { ...c });
  return {
    state: byId,
    api: {
      list: async (): Promise<StickyListMeta> => {
        // Re-emit each page with current bodies, dropping ids that
        // have been removed. Overlap is preserved.
        const comments: StickyComment[] = [];
        for (const page of pages) {
          for (const c of page) {
            const live = byId.get(c.id);
            if (live) comments.push({ id: live.id, body: live.body });
          }
        }
        return { comments, pagesWalked: pages.length };
      },
      create: async (body) => {
        const id = Math.max(0, ...byId.keys()) + 1;
        const c = { id, body };
        byId.set(id, c);
        return c;
      },
      update: async (id, body) => {
        const c = byId.get(id)!;
        c.body = body;
        return { ...c };
      },
      remove: async (id) => {
        byId.delete(id);
      },
    } satisfies StickyApi,
  };
}

describe("newest sticky selection across timestamps + paginated overlap", () => {
  it("global newest id wins even when an OLDER comment appears on a LATER page", async () => {
    // Page 1 contains the newest (id=900); pages 2/3 contain older ids.
    // A naive impl that took "last seen" would pick id=100 (page 3 tail).
    const { api, state } = makeOverlappingApi([
      [
        mk(900, "2026-05-20T10:00:00Z", "ci-newest"),
        mk(300, "2026-05-19T08:00:00Z", "ci-mid"),
      ],
      [
        mk(200, "2026-05-18T08:00:00Z", "manual-paste"),
      ],
      [
        mk(100, "2026-05-17T08:00:00Z", "ancient"),
      ],
    ]);

    const res = await upsertStickyComment({ api, marker: MARKER, body: "fresh" });
    summarizeScan("newest-on-first-page", res);

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(900);
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([100, 200, 300]);
    expect([...state.keys()]).toEqual([900]);
  });

  it("when the same id surfaces on TWO overlapping pages, it counts ONCE and still wins if newest", async () => {
    // id=900 appears on BOTH page 1 and page 2 (pagination overlap).
    // It must still be selected (newest), and must not be treated as
    // two separate matches (no double-cleanup, no spurious remove).
    const { api, state } = makeOverlappingApi([
      [
        mk(900, "2026-05-20T10:00:00Z", "ci-newest"),
        mk(500, "2026-05-19T10:00:00Z", "older-a"),
      ],
      [
        mk(900, "2026-05-20T10:00:00Z", "ci-newest-dup-page"),
        mk(400, "2026-05-18T10:00:00Z", "older-b"),
      ],
    ]);

    const res = await upsertStickyComment({ api, marker: MARKER, body: "fresh" });
    summarizeScan("overlap-newest-dup-page", res);

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(900);
    // Only the two truly-older ids are cleaned; id=900 is not removed
    // even though it appeared twice in the listing.
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([400, 500]);
    expect([...state.keys()].sort((a, b) => a - b)).toEqual([900]);
  });

  it("non-monotonic timestamps vs ids: id wins (GitHub's monotonic ordering)", async () => {
    // Synthetic case: a comment with a LATER ts but LOWER id (e.g.
    // someone edited an older comment's body to bump its timestamp).
    // The upsert MUST still pick by id, not by parsed ts.
    const { api, state } = makeOverlappingApi([
      [
        mk(700, "2026-05-21T23:59:59Z", "edited-old"), // later ts, lower id
        mk(800, "2026-05-20T10:00:00Z", "real-newest"), // earlier ts, higher id
      ],
      [
        mk(600, "2026-05-19T10:00:00Z", "ancient"),
      ],
    ]);

    const res = await upsertStickyComment({ api, marker: MARKER, body: "fresh" });
    summarizeScan("ts-vs-id mismatch", res);

    expect(res.comment.id).toBe(800);
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([600, 700]);
    expect([...state.keys()]).toEqual([800]);
  });

  it("rerun after overlap convergence is a no-op cleanup with the same id", async () => {
    const { api } = makeOverlappingApi([
      [mk(900, "2026-05-20T10:00:00Z", "n"), mk(500, "2026-05-19T10:00:00Z", "o1")],
      [mk(900, "2026-05-20T10:00:00Z", "n-dup"), mk(400, "2026-05-18T10:00:00Z", "o2")],
    ]);
    const first = await upsertStickyComment({ api, marker: MARKER, body: "fresh" });
    const second = await upsertStickyComment({ api, marker: MARKER, body: "fresh-2" });
    summarizeScan("overlap rerun", second);

    expect(first.comment.id).toBe(900);
    expect(second.action).toBe("updated");
    expect(second.comment.id).toBe(900);
    expect(second.cleaned).toHaveLength(0);
  });
});
