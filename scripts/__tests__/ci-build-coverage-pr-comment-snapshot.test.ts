// Snapshot tests pinning the EXACT rendered PR comment markdown body
// for every validateOutcome × missing-artifact combination that the
// sticky coverage comment can produce in CI. If anyone tweaks the
// link_or_missing format, the variant gating, or the per-OS reference
// block, these snapshots fail loudly so reviewers see the diff before
// CI starts posting changed comments on real PRs.
//
// Combinations covered:
//   • validator-failed                (suppresses every link)
//   • success / all artifacts present
//   • success / debug-bundle missing
//   • success / step-summary missing
//   • success / failure-breakdown missing
//   • success / coverage missing
//   • success / ALL artifacts missing
//   • success / empty-string ids      (degrade to "not uploaded")
//   • success / whitespace-only ids   (degrade to "not uploaded")
import { describe, expect, it } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const RUN = "https://github.com/o/r/actions/runs/42";
const ALL = {
  runUrl: RUN,
  validateOutcome: "success",
  coverageArtifactId: "cov-1",
  debugBundleArtifactId: "deb-1",
  stepSummaryArtifactId: "step-1",
  failureBreakdownArtifactId: "fb-1",
} as const;

describe("buildCoverageComment — markdown snapshots", () => {
  it("validator-failed: suppresses every link", () => {
    expect(buildCoverageComment({ ...ALL, validateOutcome: "failure" })).toMatchSnapshot();
  });

  it("success: all artifacts present", () => {
    expect(buildCoverageComment(ALL)).toMatchSnapshot();
  });

  it("success: debug-bundle missing", () => {
    expect(
      buildCoverageComment({ ...ALL, debugBundleArtifactId: undefined }),
    ).toMatchSnapshot();
  });

  it("success: step-summary missing", () => {
    expect(
      buildCoverageComment({ ...ALL, stepSummaryArtifactId: undefined }),
    ).toMatchSnapshot();
  });

  it("success: failure-breakdown missing", () => {
    expect(
      buildCoverageComment({ ...ALL, failureBreakdownArtifactId: undefined }),
    ).toMatchSnapshot();
  });

  it("success: coverage missing", () => {
    expect(
      buildCoverageComment({ ...ALL, coverageArtifactId: undefined }),
    ).toMatchSnapshot();
  });

  it("success: ALL artifact ids missing", () => {
    expect(
      buildCoverageComment({ runUrl: RUN, validateOutcome: "success" }),
    ).toMatchSnapshot();
  });

  it("success: empty-string ids degrade to the missing form", () => {
    expect(
      buildCoverageComment({
        runUrl: RUN,
        validateOutcome: "success",
        coverageArtifactId: "",
        debugBundleArtifactId: "",
        stepSummaryArtifactId: "",
        failureBreakdownArtifactId: "",
      }),
    ).toMatchSnapshot();
  });

  it("success: whitespace-only ids degrade to the missing form", () => {
    expect(
      buildCoverageComment({
        runUrl: RUN,
        validateOutcome: "success",
        coverageArtifactId: "   ",
        debugBundleArtifactId: "\t",
        stepSummaryArtifactId: "\n",
        failureBreakdownArtifactId: " \t \n ",
      }),
    ).toMatchSnapshot();
  });

  it("validator-cancelled outcome also suppresses (any non-success)", () => {
    expect(
      buildCoverageComment({ ...ALL, validateOutcome: "cancelled" }),
    ).toMatchSnapshot();
  });
});
