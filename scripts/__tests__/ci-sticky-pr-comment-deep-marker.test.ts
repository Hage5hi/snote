// The sticky marker doesn't always land near the top of a comment.
// Reviewers may quote earlier output, prepend a TL;DR, or paste long
// logs before the marker line. The detector + upsert path must still
// find and update the right comment without throwing — even when the
// marker is buried several lines deep.
//
// Note: the production detector intentionally only scans the first
// ~5 lines (see ci-sticky-marker-detection-whitespace.test.ts) so the
// "deep marker" case here uses a dedicated full-body scanner that the
// upsert path falls back to when the head-scan misses.
import { describe, expect, it, vi } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";
import { hasStickyMarker } from "./ci-sticky-marker-detection-whitespace.test";

const HEADER = "i18n-cli-coverage";
const MARKER = `<!-- Sticky Pull Request Comment${HEADER} -->`;
const RUN = "https://github.com/o/r/actions/runs/77";

/** Full-body fallback: marker may appear anywhere in the comment. */
function hasStickyMarkerAnywhere(body: unknown, marker = MARKER): boolean {
  if (typeof body !== "string" || body.length === 0) return false;
  const normalized = body.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  return normalized.split("\n").some((line) => line.trim() === marker.trim());
}

interface Comment { id: number; body: string }

function makeApi(seed: Comment[]) {
  const comments = seed.map((c) => ({ ...c }));
  let nextId = comments.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const create = vi.fn(async (body: string) => {
    const c = { id: nextId++, body: `${MARKER}\n${body}` };
    comments.push(c);
    return c;
  });
  const update = vi.fn(async (id: number, body: string) => {
    const c = comments.find((x) => x.id === id)!;
    c.body = `${MARKER}\n${body}`;
    return c;
  });
  const upsert = async (body: string) => {
    const matches = comments.filter((c) => hasStickyMarkerAnywhere(c.body));
    if (matches.length > 0) {
      const newest = matches.reduce((a, b) => (a.id > b.id ? a : b));
      return update(newest.id, body);
    }
    return create(body);
  };
  return { comments, create, update, upsert };
}

const NOISE = [
  "## TL;DR",
  "Previous run output:",
  "```",
  "some log line",
  "another log line",
  "yet more output",
  "```",
  "",
  "Full report below:",
  "",
].join("\n");

describe("sticky marker detection — deeply buried marker", () => {
  it.each([
    ["after 3 non-empty lines", `line1\nline2\nline3\n${MARKER}\nrest`],
    ["after a quoted log block", `${NOISE}${MARKER}\nrest`],
    ["after ~20 lines of noise", `${"noise line\n".repeat(20)}${MARKER}\nrest`],
    ["with leading whitespace deep in the body", `${NOISE}  ${MARKER}\t\nrest`],
    ["with CRLF noise and deep marker", `a\r\nb\r\nc\r\nd\r\n${MARKER}\r\nrest`],
  ])("hasStickyMarkerAnywhere matches: %s", (_label, body) => {
    let result: unknown;
    expect(() => { result = hasStickyMarkerAnywhere(body); }).not.toThrow();
    expect(result).toBe(true);
  });

  it("head-only detector intentionally MISSES deep markers (documents the boundary)", () => {
    const body = `${NOISE}${MARKER}\nrest`;
    expect(hasStickyMarker(body)).toBe(false);
    expect(hasStickyMarkerAnywhere(body)).toBe(true);
  });

  it("upsert finds and updates the deeply-buried marker comment, no duplicate created", async () => {
    const api = makeApi([
      { id: 1, body: "totally unrelated review comment" },
      { id: 2, body: `${NOISE}${MARKER}\nstale body — cov-OLD` },
      { id: 3, body: "another unrelated comment" },
    ]);
    const fresh = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov-NEW",
      debugBundleArtifactId: "deb-NEW",
      stepSummaryArtifactId: "step-NEW",
      failureBreakdownArtifactId: "fb-NEW",
    });
    await api.upsert(fresh);

    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith(2, fresh);
    expect(api.comments).toHaveLength(3);
    // Unrelated comments untouched.
    expect(api.comments.find((c) => c.id === 1)!.body).toBe("totally unrelated review comment");
    expect(api.comments.find((c) => c.id === 3)!.body).toBe("another unrelated comment");
  });

  it("two reruns against a deeply-buried marker stay sticky (no duplicates, latest wins)", async () => {
    const api = makeApi([
      { id: 9, body: `${NOISE}${MARKER}\nstale` },
    ]);
    for (const v of ["A", "B"]) {
      await api.upsert(
        buildCoverageComment({
          runUrl: RUN,
          validateOutcome: "success",
          coverageArtifactId: `cov-${v}`,
          debugBundleArtifactId: `deb-${v}`,
          stepSummaryArtifactId: `step-${v}`,
          failureBreakdownArtifactId: `fb-${v}`,
        }),
      );
    }
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledTimes(2);
    expect(api.comments).toHaveLength(1);
    expect(api.comments[0].body).toContain("cov-B");
    expect(api.comments[0].body).not.toContain("cov-A");
  });
});
