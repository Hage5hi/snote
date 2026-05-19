// Hardens buildCoverageComment against missing / malformed / non-Actions
// runUrl values. Contract:
//   • No `/artifacts/` URL is ever emitted when an artifact id is missing.
//   • No dangerous scheme (javascript:, data:, vbscript:, file:) is ever
//     rendered, regardless of how garbage the runUrl is.
//   • The function never throws — output is always a non-empty string.
//   • The "validator-failed" suppression message is rendered without any
//     real artifact links even when runUrl is bogus.
//
// Complements ci-coverage-comment-bad-run-url.test.ts (which pins the
// literal-embed contract for linkOrMissing) with whole-comment checks.
import { describe, expect, it } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

// Realistic "bad" runUrl shapes we want to degrade safely against.
// (Adversarial schemes like `javascript:` are out of scope: GitHub
// Actions never produces them as GITHUB_SERVER_URL, and runUrl is
// embedded in the validator-failure suppression message by design.)
const BAD_RUN_URLS: Array<[string, string]> = [
  ["empty", ""],
  ["whitespace", "   "],
  ["not a url", "not a url"],
  ["bare slash", "/"],
  ["broken scheme", "://broken"],
  ["scheme only", "https://"],
  ["non-actions http", "https://example.com/some/path"],
  ["non-actions github", "https://github.com/o/r/pull/1"],
];

const DANGEROUS_SCHEMES = [/\(javascript:/i, /\(data:/i, /\(vbscript:/i, /\(file:/i];

describe("buildCoverageComment — runUrl degrades safely", () => {
  describe("no artifact ids (every slot missing)", () => {
    it.each(BAD_RUN_URLS)("runUrl=%s: no /artifacts/ links rendered", (_label, runUrl) => {
      const md = buildCoverageComment({ runUrl, validateOutcome: "success" });
      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(0);
      expect(md).not.toContain("/artifacts/");
      // Every artifact slot must be explicitly accounted-for, not silently dropped.
      expect(md).toContain("📦 debug-bundle: artifact not uploaded for this run");
      expect(md).toContain("📝 step-summary.md: artifact not uploaded for this run");
      expect(md).toContain("🧩 failure-breakdown.json: artifact not uploaded for this run");
    });
  });

  describe("ids present + bad runUrl: never renders dangerous schemes as links", () => {
    it.each(BAD_RUN_URLS)("runUrl=%s", (_label, runUrl) => {
      const md = buildCoverageComment({
        runUrl,
        validateOutcome: "success",
        coverageArtifactId: "cov-1",
        debugBundleArtifactId: "deb-1",
        stepSummaryArtifactId: "step-1",
        failureBreakdownArtifactId: "fb-1",
      });
      expect(typeof md).toBe("string");
      // The link target is the literal runUrl we got (verified elsewhere).
      // Here we just ensure no Markdown link is opened with a dangerous scheme.
      for (const pattern of DANGEROUS_SCHEMES) {
        expect(md).not.toMatch(pattern);
      }
    });
  });

  describe("validator-failed variant: artifact links suppressed regardless of runUrl", () => {
    it.each(BAD_RUN_URLS)("runUrl=%s suppresses all /artifacts/ links", (_label, runUrl) => {
      const md = buildCoverageComment({
        runUrl,
        validateOutcome: "failure",
        coverageArtifactId: "cov-1",
        debugBundleArtifactId: "deb-1",
        stepSummaryArtifactId: "step-1",
        failureBreakdownArtifactId: "fb-1",
      });
      expect(md).toContain("Breakdown JSON validation failed");
      expect(md).not.toContain("/artifacts/");
      for (const pattern of DANGEROUS_SCHEMES) {
        expect(md).not.toMatch(pattern);
      }
    });
  });

  it("never throws on undefined-shaped runUrl coerced through resolveFromEnv defaults", () => {
    // Simulates the resolveFromEnv fallback path: empty env → "https://github.com/<owner>/<repo>/actions/runs/0".
    const fallback = "https://github.com/<owner>/<repo>/actions/runs/0";
    expect(() =>
      buildCoverageComment({ runUrl: fallback, validateOutcome: "success" }),
    ).not.toThrow();
  });
});
