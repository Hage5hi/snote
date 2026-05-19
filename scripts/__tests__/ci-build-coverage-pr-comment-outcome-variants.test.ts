// Per-outcome snapshot pinning: one snapshot per validateOutcome
// variant (success, failure, cancelled, neutral, skipped), so any
// reword of a heading, anchor label, or suppression sentence shows up
// as a single-outcome diff rather than a wide-blast change. Pairs with
// the existing outcome-matrix snapshot test (which uses it.each into
// one snapshot file) by giving each variant its own named snapshot.
import { describe, expect, it } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const RUN = "https://github.com/o/r/actions/runs/1001";
const ALL = {
  runUrl: RUN,
  coverageArtifactId: "cov-1",
  debugBundleArtifactId: "deb-1",
  stepSummaryArtifactId: "step-1",
  failureBreakdownArtifactId: "fb-1",
} as const;

describe("buildCoverageComment — per-outcome snapshots", () => {
  it("success: headings + anchors pinned", () => {
    const md = buildCoverageComment({ ...ALL, validateOutcome: "success" });
    // Hard assertions before the snapshot — easier to debug on diff.
    expect(md).toContain("### i18n CLI test coverage");
    expect(md).toContain("#### Debugging artifacts");
    expect(md).toContain("#### Per-OS matrix artifacts");
    expect(md).toContain("[📊 HTML coverage report](");
    expect(md).toContain("[📦 debug-bundle](");
    expect(md).toContain("[📝 step-summary.md](");
    expect(md).toContain("[🧩 failure-breakdown.json](");
    expect(md).not.toContain("Breakdown JSON validation failed");
    expect(md).toMatchSnapshot();
  });

  it("failure: suppression text pinned, no artifact links", () => {
    const md = buildCoverageComment({ ...ALL, validateOutcome: "failure" });
    expect(md).toContain("### i18n CLI test coverage");
    expect(md).toContain("❌ **Breakdown JSON validation failed**");
    expect(md).toContain("artifact links are suppressed");
    expect(md).not.toContain("/artifacts/");
    expect(md).not.toContain("#### Debugging artifacts");
    expect(md).not.toContain("#### Per-OS matrix artifacts");
    expect(md).toMatchSnapshot();
  });

  it("cancelled: same suppressed shape as failure, pinned independently", () => {
    const md = buildCoverageComment({ ...ALL, validateOutcome: "cancelled" });
    expect(md).toContain("❌ **Breakdown JSON validation failed**");
    expect(md).not.toContain("/artifacts/");
    expect(md).toMatchSnapshot();
  });

  it("neutral: non-'success' string suppresses links", () => {
    const md = buildCoverageComment({ ...ALL, validateOutcome: "neutral" });
    expect(md).toContain("❌ **Breakdown JSON validation failed**");
    expect(md).not.toContain("/artifacts/");
    expect(md).toMatchSnapshot();
  });

  it("skipped: non-'success' string suppresses links", () => {
    const md = buildCoverageComment({ ...ALL, validateOutcome: "skipped" });
    expect(md).toContain("❌ **Breakdown JSON validation failed**");
    expect(md).not.toContain("/artifacts/");
    expect(md).toMatchSnapshot();
  });
});
