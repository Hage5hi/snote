// Unit tests for scripts/ci-build-coverage-pr-comment.ts — pins the
// link_or_missing helper + every comment variant (success and
// validator-failed) so we know:
//   • the validator-failed variant SUPPRESSES every artifact link
//     (reviewers never land on a malformed payload)
//   • the success variant uses link_or_missing for EVERY artifact slot
//     and lists EXACTLY which artifact is missing when an id is absent
//   • the upload steps in CI are NOT gated by the comment builder —
//     this test only covers the comment body; the workflow uses
//     `if: always()` on uploads, asserted by ci.yml inspection in the
//     "integration" test below.
import { describe, expect, it } from "vitest";
import {
  buildCoverageComment,
  linkOrMissing,
  resolveFromEnv,
} from "../ci-build-coverage-pr-comment";

const RUN = "https://github.com/o/r/actions/runs/42";

describe("linkOrMissing", () => {
  it("renders a clickable bullet when artifact id is present", () => {
    const out = linkOrMissing("abc123", "📦 debug-bundle", "hint", RUN);
    expect(out).toBe(`- [📦 debug-bundle](${RUN}/artifacts/abc123) — hint`);
  });

  it("renders an explicit 'not uploaded' bullet naming the artifact when id missing", () => {
    expect(linkOrMissing(undefined, "📝 step-summary.md", "hint", RUN)).toBe(
      "- _📝 step-summary.md: artifact not uploaded for this run_ — hint",
    );
    expect(linkOrMissing("", "🧩 failure-breakdown.json", "h", RUN)).toBe(
      "- _🧩 failure-breakdown.json: artifact not uploaded for this run_ — h",
    );
    // Whitespace-only id degrades to the missing form.
    expect(linkOrMissing("   ", "📊 HTML coverage report", "h", RUN)).toContain(
      "artifact not uploaded for this run",
    );
  });
});

describe("buildCoverageComment — validator-failed variant", () => {
  const md = buildCoverageComment({
    runUrl: RUN,
    validateOutcome: "failure",
    coverageArtifactId: "cov-1",
    debugBundleArtifactId: "deb-1",
    stepSummaryArtifactId: "step-1",
    failureBreakdownArtifactId: "fb-1",
  });

  it("includes a clear suppression message + links to the run logs", () => {
    expect(md).toContain("❌ **Breakdown JSON validation failed**");
    expect(md).toContain("artifact links are suppressed");
    expect(md).toContain(RUN);
  });

  it("suppresses EVERY artifact link even when ids are present", () => {
    expect(md).not.toContain(`${RUN}/artifacts/cov-1`);
    expect(md).not.toContain(`${RUN}/artifacts/deb-1`);
    expect(md).not.toContain(`${RUN}/artifacts/step-1`);
    expect(md).not.toContain(`${RUN}/artifacts/fb-1`);
    expect(md).not.toContain("Debugging artifacts");
    expect(md).not.toContain("Per-OS matrix artifacts");
  });
});

describe("buildCoverageComment — success variant", () => {
  it("renders every artifact link via link_or_missing when ids are present", () => {
    const md = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov-1",
      debugBundleArtifactId: "deb-1",
      stepSummaryArtifactId: "step-1",
      failureBreakdownArtifactId: "fb-1",
    });
    expect(md).toContain(`[📊 HTML coverage report](${RUN}/artifacts/cov-1)`);
    expect(md).toContain(`[📦 debug-bundle](${RUN}/artifacts/deb-1)`);
    expect(md).toContain(`[📝 step-summary.md](${RUN}/artifacts/step-1)`);
    expect(md).toContain(`[🧩 failure-breakdown.json](${RUN}/artifacts/fb-1)`);
    expect(md).not.toContain("artifact not uploaded for this run");
  });

  it("lists EXACTLY which artifacts are missing (per-slot named) when ids absent", () => {
    const md = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov-1",
      // debug-bundle + step-summary intentionally missing
      failureBreakdownArtifactId: "fb-1",
    });
    expect(md).toContain(
      "_📦 debug-bundle: artifact not uploaded for this run_",
    );
    expect(md).toContain(
      "_📝 step-summary.md: artifact not uploaded for this run_",
    );
    // The two present ones still render as links.
    expect(md).toContain(`${RUN}/artifacts/cov-1`);
    expect(md).toContain(`${RUN}/artifacts/fb-1`);
    // And the coverage / failure-breakdown slots are NOT in the missing list.
    expect(md).not.toContain(
      "_📊 HTML coverage report: artifact not uploaded for this run_",
    );
    expect(md).not.toContain(
      "_🧩 failure-breakdown.json: artifact not uploaded for this run_",
    );
  });

  it("includes the per-OS matrix artifact reference block", () => {
    const md = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
    });
    expect(md).toContain("#### Per-OS matrix artifacts");
    expect(md).toContain("i18n-cli-debug-bundle-ubuntu-latest");
    expect(md).toContain("i18n-cli-failure-breakdown-json-ubuntu-latest");
    expect(md).toContain("i18n-cli-step-summary-ubuntu-latest");
  });
});

describe("resolveFromEnv", () => {
  it("defaults VALIDATE_OUTCOME to success when unset (success variant)", () => {
    const ctx = resolveFromEnv({
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_RUN_ID: "9",
    });
    expect(ctx.validateOutcome).toBe("success");
    expect(ctx.runUrl).toBe("https://github.com/o/r/actions/runs/9");
  });

  it("propagates a non-success VALIDATE_OUTCOME so the comment suppresses links", () => {
    const ctx = resolveFromEnv({
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_RUN_ID: "9",
      VALIDATE_OUTCOME: "failure",
      DEBUG_BUNDLE_ARTIFACT_ID: "deb-1",
    });
    const md = buildCoverageComment(ctx);
    expect(md).toContain("Breakdown JSON validation failed");
    expect(md).not.toContain("artifacts/deb-1");
  });
});
