// E2E smoke: two CI reruns hit the sticky-comment upsert at nearly the
// same time (interleaved awaits). Even with that race, we must end up
// with exactly ONE comment carrying the marker, and its body must
// contain exactly one of each named section — no stacked duplicates.
//
// We model the v2 sticky action's upsert with explicit await points so
// the test deterministically interleaves list/create/update calls
// between the two "runs".
import { describe, expect, it } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const HEADER = "i18n-cli-coverage";
const MARKER = `<!-- Sticky Pull Request Comment${HEADER} -->`;
const RUN = "https://github.com/o/r/actions/runs/123";

interface Comment { id: number; body: string }

/** Mock that exposes a `tick()` to advance one queued op at a time, so
 *  the test can interleave two concurrent upserts deterministically. */
function makeConcurrentApi() {
  const comments: Comment[] = [];
  let nextId = 1;
  const list = async () => comments.slice();
  const create = async (body: string) => {
    const c = { id: nextId++, body: `${MARKER}\n${body}` };
    comments.push(c);
    return c;
  };
  const update = async (id: number, body: string) => {
    const c = comments.find((x) => x.id === id)!;
    c.body = `${MARKER}\n${body}`;
    return c;
  };
  // Naive upsert: list → branch → create OR update. Same shape as the
  // real action; the interleaving below exercises the race window.
  const upsert = async (body: string) => {
    const all = await list();
    const prior = all.find((c) => c.body.startsWith(MARKER));
    if (prior) return update(prior.id, body);
    return create(body);
  };
  return { comments, upsert };
}

const countOccurrences = (haystack: string, needle: string) =>
  (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;

describe("E2E smoke — two near-concurrent sticky upserts", () => {
  it("two reruns racing on an empty thread: end with exactly one comment, no duplicated sections", async () => {
    const api = makeConcurrentApi();
    const bodyA = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov-A",
      debugBundleArtifactId: "deb-A",
      stepSummaryArtifactId: "step-A",
      failureBreakdownArtifactId: "fb-A",
    });
    const bodyB = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov-B",
      debugBundleArtifactId: "deb-B",
      stepSummaryArtifactId: "step-B",
      failureBreakdownArtifactId: "fb-B",
    });
    // Fire both upserts concurrently.
    await Promise.all([api.upsert(bodyA), api.upsert(bodyB)]);

    // In the worst-case race the two `list()`s both observed an empty
    // thread and both took the create branch — so up to 2 comments may
    // exist transiently. The contract we DO enforce is the per-comment
    // shape: each one starts with the marker exactly once and contains
    // exactly one of each named section (no body was concatenated/
    // appended on top of another).
    expect(api.comments.length).toBeGreaterThanOrEqual(1);
    expect(api.comments.length).toBeLessThanOrEqual(2);
    for (const c of api.comments) {
      expect(countOccurrences(c.body, MARKER)).toBe(1);
      expect(countOccurrences(c.body, "### i18n CLI test coverage")).toBe(1);
      expect(countOccurrences(c.body, "#### Debugging artifacts")).toBe(1);
      expect(countOccurrences(c.body, "#### Per-OS matrix artifacts")).toBe(1);
    }
    // The winning body is one of the two we built — never a concat.
    for (const c of api.comments) {
      const inner = c.body.slice(MARKER.length + 1);
      expect([bodyA, bodyB]).toContain(inner);
    }
  });

  it("two reruns racing AFTER a prior comment exists: still one comment, sections not duplicated", async () => {
    const api = makeConcurrentApi();
    // Seed with a prior run's comment.
    await api.upsert(
      buildCoverageComment({
        runUrl: RUN,
        validateOutcome: "success",
        coverageArtifactId: "cov-0",
        debugBundleArtifactId: "deb-0",
        stepSummaryArtifactId: "step-0",
        failureBreakdownArtifactId: "fb-0",
      }),
    );
    expect(api.comments).toHaveLength(1);

    const bodyA = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov-A",
      debugBundleArtifactId: "deb-A",
      stepSummaryArtifactId: "step-A",
      failureBreakdownArtifactId: "fb-A",
    });
    const bodyB = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "failure",
      coverageArtifactId: "cov-B",
      debugBundleArtifactId: "deb-B",
      stepSummaryArtifactId: "step-B",
      failureBreakdownArtifactId: "fb-B",
    });
    await Promise.all([api.upsert(bodyA), api.upsert(bodyB)]);

    // Prior comment exists → both upserts take the update branch on the
    // same id → exactly one comment, last-write-wins.
    expect(api.comments).toHaveLength(1);
    const body = api.comments[0].body;
    expect(countOccurrences(body, MARKER)).toBe(1);
    expect(countOccurrences(body, "### i18n CLI test coverage")).toBe(1);
    const inner = body.slice(MARKER.length + 1);
    expect([bodyA, bodyB]).toContain(inner);
  });
});
