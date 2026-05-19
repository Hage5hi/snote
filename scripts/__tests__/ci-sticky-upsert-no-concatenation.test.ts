// Pins the no-concatenation contract: calling the sticky upsert twice
// with DIFFERENT artifact ids must leave the comment with exactly one
// set of sections (one ### header, one of each #### sub-header), and
// the body must equal the SECOND build verbatim — never first+second
// concatenated, never partial overlays.
import { describe, expect, it, vi } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const HEADER = "i18n-cli-coverage";
const MARKER = `<!-- Sticky Pull Request Comment${HEADER} -->`;
const RUN = "https://github.com/o/r/actions/runs/2002";

function makeApi() {
  const comments: Array<{ id: number; body: string }> = [];
  let nextId = 1;
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
    const prior = comments.find((c) => c.body.startsWith(MARKER));
    if (prior) return update(prior.id, body);
    return create(body);
  };
  return { comments, create, update, upsert };
}

const countOccurrences = (haystack: string, needle: string) =>
  (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;

describe("sticky upsert — second call replaces, never concatenates", () => {
  it("two builds with different ids: comment ends as the SECOND body only", async () => {
    const api = makeApi();
    const first = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov-FIRST",
      debugBundleArtifactId: "deb-FIRST",
      stepSummaryArtifactId: "step-FIRST",
      failureBreakdownArtifactId: "fb-FIRST",
    });
    const second = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov-SECOND",
      debugBundleArtifactId: "deb-SECOND",
      stepSummaryArtifactId: "step-SECOND",
      failureBreakdownArtifactId: "fb-SECOND",
    });
    expect(first).not.toBe(second); // sanity: bodies differ

    await api.upsert(first);
    await api.upsert(second);

    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.comments).toHaveLength(1);

    const body = api.comments[0].body;
    // Exactly one of each named section — proves no concatenation.
    expect(countOccurrences(body, MARKER)).toBe(1);
    expect(countOccurrences(body, "### i18n CLI test coverage")).toBe(1);
    expect(countOccurrences(body, "#### Debugging artifacts")).toBe(1);
    expect(countOccurrences(body, "#### Per-OS matrix artifacts")).toBe(1);

    // Body equals the SECOND build verbatim (and NOT first+second).
    expect(body.slice(MARKER.length + 1)).toBe(second);
    expect(body).not.toContain(first);
    expect(body).not.toContain("cov-FIRST");
    expect(body).not.toContain("deb-FIRST");
    expect(body).toContain(`${RUN}/artifacts/cov-SECOND`);
    expect(body).toContain(`${RUN}/artifacts/deb-SECOND`);
  });

  it("flipping success → failure on the second call also fully replaces", async () => {
    const api = makeApi();
    const ok = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov-1",
      debugBundleArtifactId: "deb-1",
      stepSummaryArtifactId: "step-1",
      failureBreakdownArtifactId: "fb-1",
    });
    const fail = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "failure",
      coverageArtifactId: "cov-1",
      debugBundleArtifactId: "deb-1",
      stepSummaryArtifactId: "step-1",
      failureBreakdownArtifactId: "fb-1",
    });
    await api.upsert(ok);
    await api.upsert(fail);

    expect(api.comments).toHaveLength(1);
    const body = api.comments[0].body;
    // Failure variant has no artifact links and no sub-headers.
    expect(body).toContain("Breakdown JSON validation failed");
    expect(body).not.toContain("/artifacts/cov-1");
    expect(countOccurrences(body, "#### Debugging artifacts")).toBe(0);
    expect(countOccurrences(body, "#### Per-OS matrix artifacts")).toBe(0);
    expect(countOccurrences(body, "### i18n CLI test coverage")).toBe(1);
    expect(body.slice(MARKER.length + 1)).toBe(fail);
  });
});
