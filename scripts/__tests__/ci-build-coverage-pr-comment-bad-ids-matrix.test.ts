// Matrix: every (validateOutcome × artifact-id-shape) combination must
// produce a body with ZERO broken artifact links. "Broken" means a
// markdown link whose href is empty, whitespace, or `…/artifacts/`
// with no id appended. When an id is empty/whitespace/undefined the
// renderer must fall back to the explicit "artifact not uploaded"
// notice, never to a half-rendered link.
import { describe, expect, it } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const RUN = "https://github.com/o/r/actions/runs/333";

const OUTCOMES = ["success", "failure", "cancelled", "skipped", "neutral", ""] as const;
const BAD_IDS: Array<[string, string | undefined]> = [
  ["undefined", undefined],
  ["empty", ""],
  ["single space", " "],
  ["multi space", "    "],
  ["tab", "\t"],
  ["newline", "\n"],
  ["mixed whitespace", " \t \n "],
];

/** Find every `[text](href)` markdown link in a body. */
const linkRegex = /\[([^\]]+)\]\(([^)]*)\)/g;

function findBrokenLinks(md: string): Array<{ text: string; href: string }> {
  const broken: Array<{ text: string; href: string }> = [];
  for (const m of md.matchAll(linkRegex)) {
    const href = m[2];
    if (href.trim() === "") broken.push({ text: m[1], href });
    // `…/artifacts/` with nothing after the slash → broken.
    if (/\/artifacts\/\s*$/.test(href)) broken.push({ text: m[1], href });
    // `…/artifacts/<only whitespace>` → broken.
    if (/\/artifacts\/\s+\S*$/.test(href) && !/\/artifacts\/\S/.test(href)) {
      broken.push({ text: m[1], href });
    }
  }
  return broken;
}

describe("buildCoverageComment — no broken links across every (outcome × bad-id) combo", () => {
  for (const outcome of OUTCOMES) {
    describe(`validateOutcome=${JSON.stringify(outcome)}`, () => {
      it.each(BAD_IDS)("all four ids = %s: no broken links", (_label, id) => {
        const md = buildCoverageComment({
          runUrl: RUN,
          validateOutcome: outcome,
          coverageArtifactId: id,
          debugBundleArtifactId: id,
          stepSummaryArtifactId: id,
          failureBreakdownArtifactId: id,
        });
        expect(typeof md).toBe("string");
        expect(md.length).toBeGreaterThan(0);
        expect(findBrokenLinks(md)).toEqual([]);
        // Hard contract: no artifact URL of any shape leaked through.
        expect(md).not.toMatch(/\(\s*\)/); // empty parens after link text
        expect(md).not.toMatch(/\/artifacts\/(\s|$|\))/);
      });

      it.each(BAD_IDS)("only debug-bundle id is bad (%s): only that slot degrades, others render", (_label, id) => {
        const md = buildCoverageComment({
          runUrl: RUN,
          validateOutcome: outcome,
          coverageArtifactId: "cov-OK",
          debugBundleArtifactId: id,
          stepSummaryArtifactId: "step-OK",
          failureBreakdownArtifactId: "fb-OK",
        });
        expect(findBrokenLinks(md)).toEqual([]);
        if (outcome === "success") {
          // Other slots still render as real links.
          expect(md).toContain(`${RUN}/artifacts/cov-OK`);
          expect(md).toContain(`${RUN}/artifacts/step-OK`);
          expect(md).toContain(`${RUN}/artifacts/fb-OK`);
          // The bad slot degrades to the explicit notice.
          expect(md).toContain("📦 debug-bundle: artifact not uploaded for this run");
          // And there's no broken `…/artifacts/` URL for debug-bundle.
          expect(md).not.toMatch(/📦 debug-bundle\]\([^)]*\/artifacts\/\s/);
        } else {
          // Non-success: every artifact link is suppressed regardless.
          expect(md).not.toContain("/artifacts/");
        }
      });
    });
  }
});
