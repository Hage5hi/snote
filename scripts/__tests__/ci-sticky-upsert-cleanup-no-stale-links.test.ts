// End-to-end: real production upsert + real buildCoverageComment,
// driven against an in-memory GitHub-comments API. Simulates two
// reruns landing on a thread that ALREADY has multiple sticky-marker
// duplicates, and pins that:
//
//   • the newest sticky comment is the one updated each rerun
//   • no new sticky comment is ever created
//   • after rerun #1 the duplicates are gone, so rerun #2 sees the
//     converged single-comment thread
//   • the final body reflects rerun #2 only (no concatenation, no
//     residue from rerun #1, no residue from the seeded duplicates)
import { describe, expect, it, vi } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";
import {
  type StickyApi,
  type StickyComment,
  upsertStickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- Sticky Pull Request Commenti18n-cli-coverage -->";
const RUN_A = "https://github.com/o/r/actions/runs/100";
const RUN_B = "https://github.com/o/r/actions/runs/101";

function makeApi(seed: StickyComment[]) {
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
  const api: StickyApi = { list, create, update, remove };
  return { api, comments, list, create, update, remove };
}

describe("E2E: sticky upsert across reruns with pre-existing duplicates", () => {
  it("two reruns converge to a single sticky comment reflecting only the latest run", async () => {
    const t = makeApi([
      { id: 5, body: `${MARKER}\nstale from run 95 — cov-OLD-1` },
      { id: 9, body: `${MARKER}\nstale from run 98 — cov-OLD-2` },
      { id: 14, body: `${MARKER}\nstale from run 99 — cov-OLD-3 (newest)` },
      { id: 15, body: "unrelated reviewer comment" },
    ]);

    // Rerun A
    const bodyA = buildCoverageComment({
      runUrl: RUN_A,
      validateOutcome: "success",
      coverageArtifactId: "covA",
      debugBundleArtifactId: "debA",
      stepSummaryArtifactId: "stepA",
      failureBreakdownArtifactId: "fbA",
    });
    const resA = await upsertStickyComment({ api: t.api, marker: MARKER, body: bodyA });
    expect(resA.action).toBe("updated");
    expect(resA.comment.id).toBe(14);
    expect(resA.cleaned.map((c) => c.id).sort()).toEqual([5, 9]);

    // Rerun B
    const bodyB = buildCoverageComment({
      runUrl: RUN_B,
      validateOutcome: "success",
      coverageArtifactId: "covB",
      debugBundleArtifactId: "debB",
      stepSummaryArtifactId: "stepB",
      failureBreakdownArtifactId: "fbB",
    });
    const resB = await upsertStickyComment({ api: t.api, marker: MARKER, body: bodyB });
    expect(resB.action).toBe("updated");
    expect(resB.comment.id).toBe(14); // same comment as rerun A
    expect(resB.cleaned).toEqual([]); // nothing left to clean

    expect(t.create).not.toHaveBeenCalled();

    // Thread converged.
    const sticky = t.comments.filter((c) => c.body.includes(MARKER) || c.body === bodyB);
    // After delete cleanup, only comment 14 + the unrelated comment remain.
    expect(t.comments).toHaveLength(2);
    expect(t.comments.find((c) => c.id === 15)!.body).toBe("unrelated reviewer comment");

    const finalSticky = t.comments.find((c) => c.id === 14)!;
    // Final body == marker + rerun B's body, nothing from rerun A or seeds.
    expect(finalSticky.body).toBe(`${MARKER}\n${bodyB}`);
    void sticky;
  });

  it("cleanup leaves NO stale artifact links anywhere in the thread", async () => {
    const STALE_RUN = "https://github.com/o/r/actions/runs/77";
    const staleBody = buildCoverageComment({
      runUrl: STALE_RUN,
      validateOutcome: "success",
      coverageArtifactId: "STALE-COV",
      debugBundleArtifactId: "STALE-DEB",
      stepSummaryArtifactId: "STALE-STEP",
      failureBreakdownArtifactId: "STALE-FB",
    });

    const t = makeApi([
      { id: 1, body: `${MARKER}\n${staleBody}` },
      { id: 2, body: `${MARKER}\n${staleBody}` },
      { id: 3, body: `${MARKER}\n${staleBody}` }, // newest = will be updated
    ]);

    const fresh = buildCoverageComment({
      runUrl: RUN_B,
      validateOutcome: "success",
      coverageArtifactId: "FRESH-COV",
      debugBundleArtifactId: "FRESH-DEB",
      stepSummaryArtifactId: "FRESH-STEP",
      failureBreakdownArtifactId: "FRESH-FB",
    });
    await upsertStickyComment({ api: t.api, marker: MARKER, body: fresh });

    // No comment in the thread may reference the stale run URL or
    // any stale artifact id — otherwise reviewers might click an old
    // link and see outdated output.
    const allBodies = t.comments.map((c) => c.body).join("\n---\n");
    expect(allBodies).not.toContain(STALE_RUN);
    expect(allBodies).not.toContain("STALE-COV");
    expect(allBodies).not.toContain("STALE-DEB");
    expect(allBodies).not.toContain("STALE-STEP");
    expect(allBodies).not.toContain("STALE-FB");

    // And the fresh body IS present, exactly once.
    const occurrences = allBodies.split("FRESH-COV").length - 1;
    expect(occurrences).toBe(1);
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0].id).toBe(3);
  });

  it("with strategy 'lock', tombstones also contain no stale artifact links", async () => {
    const STALE_RUN = "https://github.com/o/r/actions/runs/55";
    const staleBody = buildCoverageComment({
      runUrl: STALE_RUN,
      validateOutcome: "success",
      coverageArtifactId: "STALE-X",
      debugBundleArtifactId: "STALE-Y",
      stepSummaryArtifactId: "STALE-Z",
      failureBreakdownArtifactId: "STALE-W",
    });
    const t = makeApi([
      { id: 1, body: `${MARKER}\n${staleBody}` },
      { id: 2, body: `${MARKER}\n${staleBody}` },
    ]);
    const fresh = buildCoverageComment({
      runUrl: RUN_B,
      validateOutcome: "success",
      coverageArtifactId: "F1",
      debugBundleArtifactId: "F2",
      stepSummaryArtifactId: "F3",
      failureBreakdownArtifactId: "F4",
    });
    await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: fresh,
      cleanupStrategy: "lock",
    });

    // Tombstoned comment (id=1) must not retain any stale links.
    const tomb = t.comments.find((c) => c.id === 1)!;
    expect(tomb.body).not.toContain(STALE_RUN);
    expect(tomb.body).not.toContain("STALE-X");
    expect(tomb.body).not.toContain("STALE-Y");
    expect(tomb.body).not.toContain("STALE-Z");
    expect(tomb.body).not.toContain("STALE-W");
    // And it no longer carries the sticky marker so the next rerun
    // doesn't see it as a duplicate.
    expect(tomb.body).not.toContain(MARKER);
  });
});
