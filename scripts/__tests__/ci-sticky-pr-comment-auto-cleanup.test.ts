// Auto-cleanup: when multiple sticky-marker comments exist in the
// PR thread, the next rerun MUST update the most-recent one and
// remove (or lock) all the older marker-bearing duplicates so the
// thread converges to exactly ONE sticky comment.
//
// We model two cleanup strategies and pin both:
//   1. delete  — older duplicates are removed outright
//   2. lock    — older duplicates are rewritten to a tombstone body
//                that no longer carries the sticky marker
//
// Either strategy MUST leave the newest comment as the single source
// of truth, and reruns MUST remain idempotent.
import { describe, expect, it, vi } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const HEADER = "i18n-cli-coverage";
const MARKER = `<!-- Sticky Pull Request Comment${HEADER} -->`;
const TOMBSTONE = "<!-- superseded by newer sticky comment -->";
const RUN = "https://github.com/o/r/actions/runs/1234";

interface Comment { id: number; body: string }

function makeApi(seed: Comment[], strategy: "delete" | "lock" = "delete") {
  const comments = seed.map((c) => ({ ...c }));
  let nextId = comments.reduce((m, c) => Math.max(m, c.id), 0) + 1;

  const create = vi.fn(async (body: string) => {
    const c = { id: nextId++, body: `${MARKER}\n${body}` };
    comments.push(c);
    return c;
  });
  const update = vi.fn(async (id: number, body: string, opts?: { raw?: boolean }) => {
    const c = comments.find((x) => x.id === id)!;
    c.body = opts?.raw || body.startsWith(MARKER) ? body : `${MARKER}\n${body}`;
    return c;
  });
  const remove = vi.fn(async (id: number) => {
    const i = comments.findIndex((x) => x.id === id);
    if (i >= 0) comments.splice(i, 1);
  });

  const upsert = async (body: string) => {
    const matches = comments.filter((c) => c.body.startsWith(MARKER));
    if (matches.length === 0) return create(body);
    const newest = matches.reduce((a, b) => (a.id > b.id ? a : b));
    await update(newest.id, body);
    // Cleanup older duplicates.
    const older = matches.filter((c) => c.id !== newest.id);
    for (const stale of older) {
      if (strategy === "delete") {
        await remove(stale.id);
      } else {
        // lock: rewrite body so it no longer carries the marker.
        await update(stale.id, `${TOMBSTONE}\n_This sticky comment was superseded; see the latest run._`, { raw: true });
      }
    }
    return newest;
  };

  return { comments, create, update, remove, upsert };
}

const build = (cov: string) =>
  buildCoverageComment({
    runUrl: RUN,
    validateOutcome: "success",
    coverageArtifactId: cov,
    debugBundleArtifactId: `deb-${cov}`,
    stepSummaryArtifactId: `step-${cov}`,
    failureBreakdownArtifactId: `fb-${cov}`,
  });

describe("sticky upsert — auto-cleanup of duplicate marker comments", () => {
  it("delete strategy: removes all older marker comments, keeps only the newest", async () => {
    const api = makeApi(
      [
        { id: 3, body: `${MARKER}\noldest stale` },
        { id: 7, body: `${MARKER}\nmiddle stale` },
        { id: 21, body: `${MARKER}\nnewest stale` },
        { id: 22, body: "unrelated review comment" },
      ],
      "delete",
    );
    await api.upsert(build("v1"));

    // Newest marker updated, two older markers removed.
    expect(api.update).toHaveBeenCalledWith(21, expect.stringContaining("/artifacts/v1"));
    expect(api.remove).toHaveBeenCalledTimes(2);
    expect(api.remove).toHaveBeenCalledWith(3);
    expect(api.remove).toHaveBeenCalledWith(7);
    expect(api.create).not.toHaveBeenCalled();

    const remaining = api.comments.filter((c) => c.body.startsWith(MARKER));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(21);
    // Unrelated comment untouched.
    expect(api.comments.find((c) => c.id === 22)!.body).toBe("unrelated review comment");
  });

  it("lock strategy: rewrites older marker comments to tombstones (no marker)", async () => {
    const api = makeApi(
      [
        { id: 1, body: `${MARKER}\nstale A` },
        { id: 2, body: `${MARKER}\nstale B` },
        { id: 9, body: `${MARKER}\nstale C (newest)` },
      ],
      "lock",
    );
    await api.upsert(build("v1"));

    expect(api.remove).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    // 1 newest update + 2 tombstone updates = 3 calls.
    expect(api.update).toHaveBeenCalledTimes(3);

    const withMarker = api.comments.filter((c) => c.body.startsWith(MARKER));
    expect(withMarker).toHaveLength(1);
    expect(withMarker[0].id).toBe(9);

    for (const id of [1, 2]) {
      const c = api.comments.find((x) => x.id === id)!;
      expect(c.body.startsWith(MARKER)).toBe(false);
      expect(c.body).toContain(TOMBSTONE);
    }
  });

  it("two reruns with pre-existing duplicates: only newest is touched, no new comments created", async () => {
    const api = makeApi(
      [
        { id: 10, body: `${MARKER}\nstale 1` },
        { id: 11, body: `${MARKER}\nstale 2` },
        { id: 12, body: `${MARKER}\nstale 3 (newest)` },
      ],
      "delete",
    );

    await api.upsert(build("run-A"));
    await api.upsert(build("run-B"));

    expect(api.create).not.toHaveBeenCalled();
    // Both reruns update comment id=12.
    const updatedIds = api.update.mock.calls.map((c) => c[0]);
    expect(updatedIds).toEqual([12, 12]);

    expect(api.comments).toHaveLength(1);
    expect(api.comments[0].id).toBe(12);
    // Final body reflects the SECOND rerun, not the first.
    expect(api.comments[0].body).toContain(`${RUN}/artifacts/run-B`);
    expect(api.comments[0].body).not.toContain("run-A");
  });

  it("idempotent: after cleanup, a third rerun with no duplicates just updates in place", async () => {
    const api = makeApi(
      [
        { id: 4, body: `${MARKER}\nstale` },
        { id: 5, body: `${MARKER}\nnewest stale` },
      ],
      "delete",
    );
    await api.upsert(build("r1"));
    await api.upsert(build("r2"));
    await api.upsert(build("r3"));

    expect(api.create).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledTimes(1); // only the first rerun had duplicates
    expect(api.comments).toHaveLength(1);
    expect(api.comments[0].body).toContain("/artifacts/r3");
  });
});
