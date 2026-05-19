// Exhaustive snapshot coverage of buildCoverageComment — every
// validateOutcome value the GitHub Actions step can emit and every
// suppressed-link / partial-link permutation. Complements
// ci-build-coverage-pr-comment-snapshot.test.ts (which covers the
// most common artifact-missing combos) with the full outcome matrix
// and the edge cases where the validator step itself was skipped /
// cancelled / produced an unknown outcome.
import { describe, expect, it } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const RUN = "https://github.com/o/r/actions/runs/42";
const ALL = {
  runUrl: RUN,
  coverageArtifactId: "cov-1",
  debugBundleArtifactId: "deb-1",
  stepSummaryArtifactId: "step-1",
  failureBreakdownArtifactId: "fb-1",
} as const;

// All outcome values GitHub Actions exposes via `steps.<id>.outcome`.
// Per the contract in buildCoverageComment, anything other than the
// literal string "success" must produce the suppressed-link variant.
const OUTCOMES = [
  "success",
  "failure",
  "cancelled",
  "skipped",
  // Non-standard / unknown sentinels we want to handle defensively.
  "neutral",
  "",
  "SUCCESS", // case-sensitive: must SUPPRESS (not "success")
] as const;

describe("buildCoverageComment — full outcome matrix snapshots", () => {
  describe("with every artifact id present", () => {
    it.each(OUTCOMES)("outcome=%j", (validateOutcome) => {
      expect(buildCoverageComment({ ...ALL, validateOutcome })).toMatchSnapshot();
    });
  });

  describe("with NO artifact ids (every slot degrades)", () => {
    it.each(OUTCOMES)("outcome=%j", (validateOutcome) => {
      expect(
        buildCoverageComment({ runUrl: RUN, validateOutcome }),
      ).toMatchSnapshot();
    });
  });

  describe("suppressed-link variants are byte-identical regardless of which ids were present", () => {
    // Pin the contract: the suppressed body MUST NOT vary based on
    // artifact ids — reviewers always see the same error message,
    // never half-rendered link state.
    it("failure outcome: full-ids body === no-ids body", () => {
      const a = buildCoverageComment({ ...ALL, validateOutcome: "failure" });
      const b = buildCoverageComment({ runUrl: RUN, validateOutcome: "failure" });
      expect(a).toBe(b);
    });
    it("cancelled outcome: full-ids body === no-ids body", () => {
      const a = buildCoverageComment({ ...ALL, validateOutcome: "cancelled" });
      const b = buildCoverageComment({ runUrl: RUN, validateOutcome: "cancelled" });
      expect(a).toBe(b);
    });
    it("skipped outcome: full-ids body === no-ids body", () => {
      const a = buildCoverageComment({ ...ALL, validateOutcome: "skipped" });
      const b = buildCoverageComment({ runUrl: RUN, validateOutcome: "skipped" });
      expect(a).toBe(b);
    });
  });
});
