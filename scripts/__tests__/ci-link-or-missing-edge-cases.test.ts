// Edge-case unit tests for the link_or_missing helpers (both flavors:
// the PR-comment one in ci-build-coverage-pr-comment.ts and the
// step-summary one in ci-append-debug-links.ts).
//
// Goal: prove neither helper ever renders a broken link when the
// artifact id is empty, whitespace-only, undefined, or null. In every
// degraded case the output MUST:
//   • NOT contain "/artifacts/" (no half-built URL)
//   • NOT contain unbalanced markdown link punctuation `](`
//   • visibly name the missing artifact so reviewers know WHICH one
//     wasn't uploaded.
import { describe, expect, it } from "vitest";
import { linkOrMissing } from "../ci-build-coverage-pr-comment";
import { renderLinkLine } from "../ci-append-debug-links";

const RUN = "https://github.com/o/r/actions/runs/42";
const LABEL = "📦 debug-bundle";
const HINT = "all the things in one zip";

const DEGRADED_IDS: Array<string | undefined> = [
  undefined,
  "",
  " ",
  "   ",
  "\t",
  "\n",
  "\r\n",
  " \t \n ",
  // Cast-through-unknown handles the runtime "null from env" case
  // (process.env vars can never literally be null, but downstream
  // helpers may pass it; the helper's `id && id.trim()` guard must
  // still degrade safely).
  null as unknown as string,
];

describe("linkOrMissing (PR comment) — never renders a broken link", () => {
  it.each(DEGRADED_IDS)("degrades safely for id=%j", (id) => {
    const out = linkOrMissing(id as string | undefined, LABEL, HINT, RUN);
    expect(out).not.toContain("/artifacts/");
    expect(out).not.toContain("](");
    expect(out).toContain(LABEL);
    expect(out).toContain("artifact not uploaded for this run");
    expect(out).toContain(HINT);
  });

  it("only renders a clickable link for a non-trivial id", () => {
    const out = linkOrMissing("abc123", LABEL, HINT, RUN);
    expect(out).toBe(`- [${LABEL}](${RUN}/artifacts/abc123) — ${HINT}`);
  });

  it("preserves the id verbatim when it has leading/trailing whitespace but a real value inside", () => {
    // Intentional: today the helper does NOT trim ids before embedding.
    // This test pins that contract so any future change is intentional
    // (and the helper would still produce a valid GH artifact URL
    // because GH redirects whitespace away).
    const out = linkOrMissing(" real-id ", LABEL, HINT, RUN);
    expect(out).toContain(`/artifacts/ real-id `);
  });
});

describe("renderLinkLine (step-summary) — never renders a broken link", () => {
  it.each(DEGRADED_IDS)("degrades safely for id=%j", (id) => {
    const out = renderLinkLine({ id: id as string | undefined, label: LABEL }, RUN);
    expect(out).not.toContain("/artifacts/");
    expect(out).not.toContain("](");
    expect(out).toContain(LABEL);
    expect(out).toContain("artifact not uploaded");
  });

  it("renders the clickable form for a real id", () => {
    expect(renderLinkLine({ id: "x9", label: LABEL }, RUN)).toBe(
      `- [${LABEL}](${RUN}/artifacts/x9)`,
    );
  });
});
