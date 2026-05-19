// Exhaustive duplicate-detection: for every validateOutcome variant we
// support, buildCoverageComment's output must contain EXACTLY ONE
// instance of each documented heading/anchor — no duplicates, no
// missing entries (for the variant's expected set). The marker block
// itself is not part of buildCoverageComment's output (it's added by
// the sticky action), so we synthesize the wrapped body and assert
// exactly one marker line on the wrapped form.
import { describe, expect, it } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const HEADER = "i18n-cli-coverage";
const MARKER = `<!-- Sticky Pull Request Comment${HEADER} -->`;
const RUN = "https://github.com/o/r/actions/runs/4040";
const ALL = {
  runUrl: RUN,
  coverageArtifactId: "cov-1",
  debugBundleArtifactId: "deb-1",
  stepSummaryArtifactId: "step-1",
  failureBreakdownArtifactId: "fb-1",
} as const;

const countOccurrences = (haystack: string, needle: string) =>
  (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;

const SUCCESS_EXPECTED = [
  // Headings
  "### i18n CLI test coverage",
  "#### Debugging artifacts",
  "#### Per-OS matrix artifacts",
  // Anchor texts
  "[📊 HTML coverage report](",
  "[📦 debug-bundle](",
  "[📝 step-summary.md](",
  "[🧩 failure-breakdown.json](",
  "[run artifacts page](",
];

const SUPPRESSED_EXPECTED = [
  "### i18n CLI test coverage",
  "❌ **Breakdown JSON validation failed**",
];

const SUCCESS_OUTCOMES = ["success"] as const;
const SUPPRESSED_OUTCOMES = ["failure", "cancelled", "skipped", "neutral", ""] as const;

describe("buildCoverageComment — exactly-one duplicate audit per variant", () => {
  describe("success variant", () => {
    it.each(SUCCESS_OUTCOMES)("outcome=%j: each expected token appears exactly once", (outcome) => {
      const md = buildCoverageComment({ ...ALL, validateOutcome: outcome });
      for (const token of SUCCESS_EXPECTED) {
        expect(countOccurrences(md, token), `token: ${token}`).toBe(1);
      }
      // No suppression banner leaks into the success variant.
      expect(countOccurrences(md, "❌ **Breakdown JSON validation failed**")).toBe(0);
      // Wrap with the sticky marker and assert exactly one marker line.
      const wrapped = `${MARKER}\n${md}`;
      expect(countOccurrences(wrapped, MARKER)).toBe(1);
    });
  });

  describe("suppressed variants", () => {
    it.each(SUPPRESSED_OUTCOMES)(
      "outcome=%j: heading + suppression sentence appear exactly once; no artifact sub-headers",
      (outcome) => {
        const md = buildCoverageComment({ ...ALL, validateOutcome: outcome });
        for (const token of SUPPRESSED_EXPECTED) {
          expect(countOccurrences(md, token), `token: ${token}`).toBe(1);
        }
        // The success-only headings and anchors must NOT appear at all.
        for (const token of [
          "#### Debugging artifacts",
          "#### Per-OS matrix artifacts",
          "[📊 HTML coverage report](",
          "[📦 debug-bundle](",
          "[📝 step-summary.md](",
          "[🧩 failure-breakdown.json](",
        ]) {
          expect(countOccurrences(md, token), `should be absent: ${token}`).toBe(0);
        }
        const wrapped = `${MARKER}\n${md}`;
        expect(countOccurrences(wrapped, MARKER)).toBe(1);
      },
    );
  });

  it("success body with NO artifact ids: headings still appear exactly once each", () => {
    const md = buildCoverageComment({ runUrl: RUN, validateOutcome: "success" });
    for (const heading of [
      "### i18n CLI test coverage",
      "#### Debugging artifacts",
      "#### Per-OS matrix artifacts",
    ]) {
      expect(countOccurrences(md, heading)).toBe(1);
    }
    // Each missing-artifact notice also appears exactly once.
    for (const notice of [
      "📦 debug-bundle: artifact not uploaded for this run",
      "📝 step-summary.md: artifact not uploaded for this run",
      "🧩 failure-breakdown.json: artifact not uploaded for this run",
    ]) {
      expect(countOccurrences(md, notice)).toBe(1);
    }
  });
});
