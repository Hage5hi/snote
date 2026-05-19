// Pins the EXACT heading + anchor-text strings buildCoverageComment
// emits. Downstream dashboards / link-checkers / regex scrapers depend
// on these strings being stable across changes — accidental rewording
// is a breaking change and must show up here as a snapshot diff.
import { describe, expect, it } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const RUN = "https://github.com/o/r/actions/runs/9";
const ALL = {
  runUrl: RUN,
  validateOutcome: "success",
  coverageArtifactId: "cov-1",
  debugBundleArtifactId: "deb-1",
  stepSummaryArtifactId: "step-1",
  failureBreakdownArtifactId: "fb-1",
} as const;

describe("buildCoverageComment — stable headings & anchor text", () => {
  it("success body: every documented heading + anchor is present verbatim", () => {
    const md = buildCoverageComment(ALL);

    // Headings — exact strings, exact heading level.
    expect(md).toContain("### i18n CLI test coverage");
    expect(md).toContain("#### Debugging artifacts");
    expect(md).toContain("#### Per-OS matrix artifacts");

    // Anchor text (the visible link label) for each artifact slot.
    expect(md).toContain("[📊 HTML coverage report](");
    expect(md).toContain("[📦 debug-bundle](");
    expect(md).toContain("[📝 step-summary.md](");
    expect(md).toContain("[🧩 failure-breakdown.json](");
    expect(md).toContain("[run artifacts page](");

    // Per-OS matrix bullet labels (parsed by the dashboards).
    expect(md).toContain("i18n-cli-debug-bundle-ubuntu-latest");
    expect(md).toContain("i18n-cli-failure-breakdown-json-ubuntu-latest");
    expect(md).toContain("i18n-cli-step-summary-ubuntu-latest");
  });

  it("snapshot: full success body — pins headings, anchors, ordering, blank lines", () => {
    expect(buildCoverageComment(ALL)).toMatchSnapshot();
  });

  it("snapshot: validator-failed body — pins heading + error sentence", () => {
    expect(
      buildCoverageComment({ ...ALL, validateOutcome: "failure" }),
    ).toMatchSnapshot();
  });

  it("snapshot: success body with NO ids — pins missing-artifact anchor text", () => {
    expect(
      buildCoverageComment({ runUrl: RUN, validateOutcome: "success" }),
    ).toMatchSnapshot();
  });

  it("heading order: H3 coverage → H4 Debugging → H4 Per-OS matrix", () => {
    const md = buildCoverageComment(ALL);
    const iH3 = md.indexOf("### i18n CLI test coverage");
    const iDebug = md.indexOf("#### Debugging artifacts");
    const iMatrix = md.indexOf("#### Per-OS matrix artifacts");
    expect(iH3).toBeGreaterThanOrEqual(0);
    expect(iDebug).toBeGreaterThan(iH3);
    expect(iMatrix).toBeGreaterThan(iDebug);
  });

  it("artifact bullet order is stable: debug-bundle → step-summary.md → failure-breakdown.json", () => {
    const md = buildCoverageComment(ALL);
    const iBundle = md.indexOf("📦 debug-bundle");
    const iSummary = md.indexOf("📝 step-summary.md");
    const iBreakdown = md.indexOf("🧩 failure-breakdown.json");
    expect(iBundle).toBeGreaterThan(0);
    expect(iSummary).toBeGreaterThan(iBundle);
    expect(iBreakdown).toBeGreaterThan(iSummary);
  });
});
