// Regression: when no prior sticky comment exists (first run on a PR,
// or comment was manually deleted), the next rerun must CREATE exactly
// one new sticky comment — not skip, not duplicate. Pins the "missing
// marker → single create" branch of the upsert path.
import { describe, expect, it, vi } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const HEADER = "i18n-cli-coverage";
const MARKER = `<!-- Sticky Pull Request Comment${HEADER} -->`;
const RUN = "https://github.com/o/r/actions/runs/77";

function makeStickyApi(seedComments: Array<{ id: number; body: string }> = []) {
  const comments = seedComments.map((c) => ({ ...c }));
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
    const prior = comments.find((c) => c.body.startsWith(MARKER));
    if (prior) return update(prior.id, body);
    return create(body);
  };
  return { comments, create, update, upsert };
}

const build = (i: number) =>
  buildCoverageComment({
    runUrl: RUN,
    validateOutcome: "success",
    coverageArtifactId: `cov-${i}`,
    debugBundleArtifactId: `deb-${i}`,
    stepSummaryArtifactId: `step-${i}`,
    failureBreakdownArtifactId: `fb-${i}`,
  });

describe("sticky PR comment — missing marker on next rerun", () => {
  it("empty thread: next rerun creates exactly one new sticky comment", async () => {
    const api = makeStickyApi([]);
    await api.upsert(build(1));
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();
    expect(api.comments).toHaveLength(1);
    expect(api.comments[0].body.startsWith(MARKER)).toBe(true);
  });

  it("thread has unrelated comments (no marker): rerun creates one new comment, leaves others", async () => {
    const api = makeStickyApi([
      { id: 1, body: "drive-by review comment" },
      { id: 2, body: "<!-- some-other-marker -->\nunrelated bot" },
    ]);
    await api.upsert(build(2));
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();
    const ours = api.comments.filter((c) => c.body.startsWith(MARKER));
    expect(ours).toHaveLength(1);
    // Pre-existing comments untouched.
    expect(api.comments[0].body).toBe("drive-by review comment");
    expect(api.comments[1].body).toBe("<!-- some-other-marker -->\nunrelated bot");
  });

  it("after manual delete: subsequent rerun re-creates exactly one (not two)", async () => {
    const api = makeStickyApi([]);
    await api.upsert(build(1)); // first run → create
    // Simulate manual delete.
    api.comments.length = 0;
    await api.upsert(build(2)); // next rerun → must CREATE again, not error/skip
    expect(api.create).toHaveBeenCalledTimes(2);
    expect(api.update).not.toHaveBeenCalled();
    expect(api.comments).toHaveLength(1);
    expect(api.comments[0].body).toContain(`${RUN}/artifacts/cov-2`);
  });
});
