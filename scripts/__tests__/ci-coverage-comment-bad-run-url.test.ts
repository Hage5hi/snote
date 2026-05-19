// Verifies buildCoverageComment + linkOrMissing degrade safely when
// runUrl is missing, empty, or malformed. The contract: we'd rather
// emit a visibly-broken-looking string (so reviewers complain) than a
// real-looking clickable link that 404s or worse points at the wrong
// host. The key invariant is:
//   • when the ARTIFACT id is missing, no `/artifacts/` URL is emitted
//     regardless of runUrl shape
//   • when the artifact id is present + runUrl is empty/garbage, we
//     never produce a link with a recognizable wrong-host scheme
//     (`javascript:`, `data:`, etc.) — only the literal runUrl we were
//     given, with `/artifacts/<id>` appended.
import { describe, expect, it } from "vitest";
import {
  buildCoverageComment,
  linkOrMissing,
} from "../ci-build-coverage-pr-comment";

const LABEL = "📦 debug-bundle";

describe("linkOrMissing — bad runUrl inputs", () => {
  const BAD_URLS = ["", "   ", "not a url", "/", "://broken"];

  it.each(BAD_URLS)("never emits an artifact URL when id is missing (runUrl=%j)", (runUrl) => {
    const out = linkOrMissing(undefined, LABEL, "hint", runUrl);
    expect(out).not.toContain("/artifacts/");
    expect(out).not.toContain("](");
    expect(out).toContain(LABEL);
    expect(out).toContain("artifact not uploaded for this run");
  });

  it.each(BAD_URLS)(
    "renders a link with the literal (garbage) runUrl when id is present (runUrl=%j)",
    (runUrl) => {
      const out = linkOrMissing("abc", LABEL, "hint", runUrl);
      // Reviewer-visible: the link target is exactly what we got.
      // No silent fallback host, no scheme injection.
      expect(out).toBe(`- [${LABEL}](${runUrl}/artifacts/abc) — hint`);
      expect(out).not.toMatch(/javascript:/i);
      expect(out).not.toMatch(/data:/i);
    },
  );
});

describe("buildCoverageComment — bad runUrl inputs", () => {
  it("with empty runUrl + no ids: no /artifacts/ links anywhere", () => {
    const md = buildCoverageComment({ runUrl: "", validateOutcome: "success" });
    expect(md).not.toContain("/artifacts/");
    expect(md).toContain("artifact not uploaded for this run");
  });

  it("with empty runUrl + ids present: emits 'literal' relative links, no scheme injection", () => {
    const md = buildCoverageComment({
      runUrl: "",
      validateOutcome: "success",
      coverageArtifactId: "cov-1",
      debugBundleArtifactId: "deb-1",
      stepSummaryArtifactId: "step-1",
      failureBreakdownArtifactId: "fb-1",
    });
    // The link form is `(/artifacts/<id>)` because runUrl is "" — a
    // visibly-relative link reviewers will notice on a real PR, never
    // a real-looking link pointing at the wrong host.
    expect(md).toContain("(/artifacts/cov-1)");
    expect(md).not.toMatch(/javascript:/i);
    expect(md).not.toMatch(/data:/i);
    // The validation-failed message still references the (empty)
    // runUrl as a literal — checked below, not here.
  });

  it("validator-failed variant: still emits the suppression message even with empty runUrl", () => {
    const md = buildCoverageComment({
      runUrl: "",
      validateOutcome: "failure",
      debugBundleArtifactId: "deb-1",
    });
    expect(md).toContain("Breakdown JSON validation failed");
    expect(md).not.toContain("/artifacts/deb-1");
  });

  it("malformed runUrl: no internal exceptions, output is a string", () => {
    for (const runUrl of ["://broken", "not a url", "https://"]) {
      const md = buildCoverageComment({
        runUrl,
        validateOutcome: "success",
        debugBundleArtifactId: "deb-1",
      });
      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(0);
      // Whatever runUrl we got, it's substring-embedded — no rewrite.
      expect(md).toContain(`${runUrl}/artifacts/deb-1`);
    }
  });
});
