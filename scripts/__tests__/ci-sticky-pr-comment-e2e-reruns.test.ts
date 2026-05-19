// End-to-end smoke: simulate many CI reruns hitting the sticky comment
// API and assert (a) only one comment ever exists with our marker,
// (b) the body has exactly one "Debugging artifacts" / "Per-OS matrix
// artifacts" section after each upsert (no stacked duplicates), and
// (c) the body always reflects the LATEST run's artifact ids.
//
// Models the marocchino/sticky-pull-request-comment@v2 action in
// memory using its header-marker convention.
import { describe, expect, it, vi } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const RUN = "https://github.com/o/r/actions/runs/100";
const HEADER = "i18n-cli-coverage";
const MARKER = `<!-- Sticky Pull Request Comment${HEADER} -->`;

function makeStickyApi() {
  const comments: Array<{ id: number; body: string }> = [];
  let nextId = 1;
  const upsert = vi.fn(async (body: string) => {
    const prior = comments.find((c) => c.body.startsWith(MARKER));
    if (prior) {
      prior.body = `${MARKER}\n${body}`;
      return prior;
    }
    const c = { id: nextId++, body: `${MARKER}\n${body}` };
    comments.push(c);
    return c;
  });
  return { comments, upsert };
}

const countOccurrences = (haystack: string, needle: string) =>
  (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;

describe("E2E smoke — sticky PR comment across many reruns", () => {
  it("10 reruns leave exactly one comment with non-duplicated sections + latest ids", async () => {
    const api = makeStickyApi();
    let lastBody = "";
    let lastDebugId = "";
    for (let i = 0; i < 10; i++) {
      lastDebugId = `deb-${i}`;
      lastBody = buildCoverageComment({
        runUrl: RUN,
        validateOutcome: "success",
        coverageArtifactId: `cov-${i}`,
        debugBundleArtifactId: lastDebugId,
        stepSummaryArtifactId: `step-${i}`,
        failureBreakdownArtifactId: `fb-${i}`,
      });
      await api.upsert(lastBody);

      // Invariant after EVERY upsert: exactly one comment, exactly one
      // marker, exactly one of each named section. (Pins the contract
      // even if a future bug accidentally appends instead of replaces.)
      expect(api.comments).toHaveLength(1);
      const body = api.comments[0].body;
      expect(countOccurrences(body, MARKER)).toBe(1);
      expect(countOccurrences(body, "### i18n CLI test coverage")).toBe(1);
      expect(countOccurrences(body, "#### Debugging artifacts")).toBe(1);
      expect(countOccurrences(body, "#### Per-OS matrix artifacts")).toBe(1);
    }

    expect(api.upsert).toHaveBeenCalledTimes(10);
    // Final body reflects the LATEST run's ids, not a stale earlier run.
    expect(api.comments[0].body).toContain(`${RUN}/artifacts/${lastDebugId}`);
    expect(api.comments[0].body).toContain(`${RUN}/artifacts/cov-9`);
    expect(api.comments[0].body).not.toContain(`${RUN}/artifacts/deb-0`);
    expect(api.comments[0].body).not.toContain(`${RUN}/artifacts/cov-0`);
  });

  it("reruns that flip success ↔ failure still leave one comment with the latest body", async () => {
    const api = makeStickyApi();
    const flips = ["success", "failure", "success", "failure", "success"] as const;
    for (const outcome of flips) {
      await api.upsert(
        buildCoverageComment({
          runUrl: RUN,
          validateOutcome: outcome,
          coverageArtifactId: "cov-x",
          debugBundleArtifactId: "deb-x",
          stepSummaryArtifactId: "step-x",
          failureBreakdownArtifactId: "fb-x",
        }),
      );
      expect(api.comments).toHaveLength(1);
      expect(countOccurrences(api.comments[0].body, MARKER)).toBe(1);
    }
    // Last flip was "success" → links present, no failure banner.
    expect(api.comments[0].body).toContain(`${RUN}/artifacts/cov-x`);
    expect(api.comments[0].body).not.toContain("Breakdown JSON validation failed");
  });
});
