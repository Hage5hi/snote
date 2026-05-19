// Pins the real production upsert in scripts/ci-sticky-pr-comment-upsert.ts:
// when multiple sticky-marker comments already exist, the NEWEST one is
// updated and all older duplicates are cleaned up (delete by default,
// lock when delete is unavailable).
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CLEANUP_STRATEGY,
  DEFAULT_TOMBSTONE,
  type StickyApi,
  type StickyComment,
  upsertStickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- Sticky Pull Request Commenti18n-cli-coverage -->";

function makeApi(seed: StickyComment[], withRemove = true) {
  const comments = seed.map((c) => ({ ...c }));
  let nextId = comments.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const list = vi.fn(async () => comments.map((c) => ({ ...c })));
  const create = vi.fn(async (body: string) => {
    const c = { id: nextId++, body: `${MARKER}\n${body}` };
    comments.push(c);
    return { ...c };
  });
  const update = vi.fn(async (id: number, body: string) => {
    const c = comments.find((x) => x.id === id)!;
    c.body = body;
    return { ...c };
  });
  const remove = vi.fn(async (id: number) => {
    const i = comments.findIndex((x) => x.id === id);
    if (i >= 0) comments.splice(i, 1);
  });
  const api: StickyApi = withRemove
    ? { list, create, update, remove }
    : { list, create, update };
  return { api, comments, list, create, update, remove };
}

describe("upsertStickyComment — duplicate cleanup (production code)", () => {
  it("default strategy is 'delete'", () => {
    expect(DEFAULT_CLEANUP_STRATEGY).toBe("delete");
  });

  it("updates the NEWEST marker comment and deletes older duplicates by default", async () => {
    const t = makeApi([
      { id: 3, body: `${MARKER}\noldest stale` },
      { id: 7, body: `${MARKER}\nmiddle stale` },
      { id: 21, body: `${MARKER}\nnewest stale` },
      { id: 22, body: "unrelated review comment" },
    ]);
    const res = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "fresh body v1",
    });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(21);
    expect(t.create).not.toHaveBeenCalled();
    expect(t.update).toHaveBeenCalledWith(21, `${MARKER}\nfresh body v1`);
    expect(t.remove).toHaveBeenCalledTimes(2);
    expect(t.remove).toHaveBeenCalledWith(3);
    expect(t.remove).toHaveBeenCalledWith(7);
    expect(res.cleaned).toEqual([
      { id: 3, via: "delete" },
      { id: 7, via: "delete" },
    ]);

    // Thread converged to a single sticky comment + the unrelated one.
    expect(t.comments).toHaveLength(2);
    expect(t.comments.find((c) => c.id === 22)!.body).toBe("unrelated review comment");
  });

  it("lock strategy rewrites stale duplicates to tombstones (no marker)", async () => {
    const t = makeApi([
      { id: 1, body: `${MARKER}\nstale A` },
      { id: 2, body: `${MARKER}\nstale B` },
      { id: 9, body: `${MARKER}\nstale C (newest)` },
    ]);
    const res = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "fresh body",
      cleanupStrategy: "lock",
    });

    expect(t.remove).not.toHaveBeenCalled();
    expect(res.cleaned).toEqual([
      { id: 1, via: "lock" },
      { id: 2, via: "lock" },
    ]);
    expect(t.comments.find((c) => c.id === 1)!.body).toBe(DEFAULT_TOMBSTONE);
    expect(t.comments.find((c) => c.id === 2)!.body).toBe(DEFAULT_TOMBSTONE);
    expect(t.comments.find((c) => c.id === 9)!.body).toBe("fresh body");
  });

  it("falls back to lock automatically when api.remove is not provided", async () => {
    const t = makeApi(
      [
        { id: 1, body: `${MARKER}\nstale` },
        { id: 2, body: `${MARKER}\nnewest stale` },
      ],
      /* withRemove */ false,
    );
    const res = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "fresh",
      cleanupStrategy: "delete", // requested, but unavailable
    });
    expect(res.cleaned).toEqual([{ id: 1, via: "lock" }]);
    expect(t.comments.find((c) => c.id === 1)!.body).toBe(DEFAULT_TOMBSTONE);
  });

  it("two reruns with pre-existing duplicates: only newest is updated, no new comments created", async () => {
    const t = makeApi([
      { id: 10, body: `${MARKER}\nstale 1` },
      { id: 11, body: `${MARKER}\nstale 2` },
      { id: 12, body: `${MARKER}\nstale 3 (newest)` },
    ]);
    await upsertStickyComment({ api: t.api, marker: MARKER, body: "run-A body" });
    await upsertStickyComment({ api: t.api, marker: MARKER, body: "run-B body" });

    expect(t.create).not.toHaveBeenCalled();
    const updatedIds = t.update.mock.calls.map((c) => c[0]);
    // First rerun: update #12 (newest sticky). Second rerun: only #12 remains.
    expect(updatedIds).toEqual([12, 12]);
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0].id).toBe(12);
    expect(t.comments[0].body).toBe("run-B body");
  });

  it("creates a fresh comment when no marker comments exist", async () => {
    const t = makeApi([{ id: 1, body: "unrelated" }]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });
    expect(res.action).toBe("created");
    expect(t.create).toHaveBeenCalledOnce();
    expect(res.cleaned).toEqual([]);
  });
});
