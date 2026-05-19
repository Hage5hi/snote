// Integration test: the sticky PR comment (posted by
// marocchino/sticky-pull-request-comment@v2 in ci.yml) must be
// REPLACED, not duplicated, across reruns — for every validateOutcome.
//
// We don't call the real GitHub API. Instead we model the v2 action's
// behavior in a tiny in-memory mock that uses the same header-marker
// convention the action embeds:
//   <!-- Sticky Pull Request Comment<header> -->
// On each "run" we build the body with buildCoverageComment(), then
// upsert via the mock. After many reruns there must be exactly ONE
// comment with that marker, and its body must equal the latest build.
import { describe, expect, it, vi } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

interface Comment {
  id: number;
  body: string;
}

/**
 * Minimal mock of the v2 sticky action. Finds an existing comment by
 * the action's HTML-comment marker and PATCHes it; otherwise POSTs a
 * new one. Exposes spies so the test can assert the call pattern.
 */
function makeStickyApi(header: string) {
  const comments: Comment[] = [];
  let nextId = 1;
  const marker = `<!-- Sticky Pull Request Comment${header} -->`;

  const list = vi.fn(async () => comments.slice());
  const create = vi.fn(async (body: string) => {
    const c = { id: nextId++, body: `${marker}\n${body}` };
    comments.push(c);
    return c;
  });
  const update = vi.fn(async (id: number, body: string) => {
    const c = comments.find((x) => x.id === id);
    if (!c) throw new Error(`comment ${id} not found`);
    c.body = `${marker}\n${body}`;
    return c;
  });

  /** Upsert behavior the v2 action implements. */
  const upsert = async (body: string) => {
    const all = await list();
    const prior = all.find((c) => c.body.startsWith(marker));
    if (prior) return update(prior.id, body);
    return create(body);
  };

  return { comments, marker, list, create, update, upsert };
}

const RUN = "https://github.com/o/r/actions/runs/42";
const ALL_IDS = {
  runUrl: RUN,
  coverageArtifactId: "cov-1",
  debugBundleArtifactId: "deb-1",
  stepSummaryArtifactId: "step-1",
  failureBreakdownArtifactId: "fb-1",
} as const;

describe("sticky PR comment upsert across reruns (mocked GitHub API)", () => {
  it.each(["success", "failure", "cancelled", "skipped"])(
    "validateOutcome=%s: 5 reruns produce exactly one comment with the latest body",
    async (outcome) => {
      const api = makeStickyApi("i18n-cli-coverage");
      let latestBody = "";
      for (let i = 0; i < 5; i++) {
        latestBody = buildCoverageComment({
          ...ALL_IDS,
          validateOutcome: outcome,
          // Vary one id per run to prove the body is actually
          // refreshed (not just left stale by an idempotent no-op).
          debugBundleArtifactId: `deb-${i}`,
        });
        await api.upsert(latestBody);
      }
      expect(api.comments).toHaveLength(1);
      expect(api.create).toHaveBeenCalledTimes(1);
      expect(api.update).toHaveBeenCalledTimes(4);
      expect(api.comments[0].body).toContain(latestBody);
      expect(api.comments[0].body.startsWith(api.marker)).toBe(true);
    },
  );

  it("switching validateOutcome between reruns updates the same comment (no duplicates)", async () => {
    const api = makeStickyApi("i18n-cli-coverage");
    const outcomes = ["success", "failure", "success", "cancelled", "success"] as const;
    let latestBody = "";
    for (const outcome of outcomes) {
      latestBody = buildCoverageComment({ ...ALL_IDS, validateOutcome: outcome });
      await api.upsert(latestBody);
    }
    expect(api.comments).toHaveLength(1);
    expect(api.update).toHaveBeenCalledTimes(outcomes.length - 1);
    // Final outcome is "success" → must contain a real artifact link,
    // proving the body is the latest write (not a stale failure body).
    expect(api.comments[0].body).toContain(`${RUN}/artifacts/cov-1`);
    expect(api.comments[0].body).not.toContain("Breakdown JSON validation failed");
  });

  it("a different header creates a SEPARATE comment (sanity check on the marker scoping)", async () => {
    const a = makeStickyApi("i18n-cli-coverage");
    const b = makeStickyApi("other-header");
    await a.upsert(buildCoverageComment({ ...ALL_IDS, validateOutcome: "success" }));
    await b.upsert(buildCoverageComment({ ...ALL_IDS, validateOutcome: "success" }));
    expect(a.comments).toHaveLength(1);
    expect(b.comments).toHaveLength(1);
    expect(a.comments[0].body).not.toEqual(b.comments[0].body);
  });
});
