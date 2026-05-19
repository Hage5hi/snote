// Pins the "literal string 'success'" gate in buildCoverageComment:
// any other validateOutcome value — including subtle variants
// (different casing, surrounding whitespace, common typos, GH's
// "neutral"/"timed_out"/"action_required") MUST produce the
// suppressed-link variant. Snapshotted so a regression that lets
// e.g. " success " through is immediately visible in the diff.
import { describe, expect, it } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const RUN = "https://github.com/o/r/actions/runs/42";
const IDS = {
  coverageArtifactId: "cov-1",
  debugBundleArtifactId: "deb-1",
  stepSummaryArtifactId: "step-1",
  failureBreakdownArtifactId: "fb-1",
} as const;

const NON_SUCCESS = [
  // GH Actions documented outcomes other than "success"
  "failure",
  "cancelled",
  "skipped",
  "neutral",
  "timed_out",
  "action_required",
  // Subtle / accidental variants that MUST still suppress
  "Success",
  "SUCCESS",
  " success",
  "success ",
  " success ",
  "succes", // typo
  "true",
  "ok",
  "1",
  "0",
  "",
  "undefined",
  "null",
];

describe("buildCoverageComment — only literal 'success' renders links", () => {
  it.each(NON_SUCCESS)("validateOutcome=%j → suppressed-link snapshot", (validateOutcome) => {
    const body = buildCoverageComment({ runUrl: RUN, validateOutcome, ...IDS });
    // Hard invariants (in addition to the snapshot):
    expect(body).toContain("Breakdown JSON validation failed");
    expect(body).not.toContain(`${RUN}/artifacts/`);
    expect(body).not.toContain("Debugging artifacts");
    expect(body).not.toContain("Per-OS matrix artifacts");
    expect(body).toMatchSnapshot();
  });

  it("the literal string 'success' is the ONLY value that renders links", () => {
    const body = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      ...IDS,
    });
    expect(body).toContain(`${RUN}/artifacts/cov-1`);
    expect(body).not.toContain("Breakdown JSON validation failed");
  });
});
