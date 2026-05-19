// Edge case: multiple comments carrying the sticky marker already
// exist (e.g. from a prior bug, a race that produced doubles, or a
// manual paste). The next rerun MUST update one of them in-place —
// preferring the most recent — and MUST NOT create a third.
//
// Pins the "pick most recent matching marker" branch of the upsert
// path. Highest comment id wins (matches GitHub's monotonic id order).
import { describe, expect, it, vi } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const HEADER = "i18n-cli-coverage";
const MARKER = `<!-- Sticky Pull Request Comment${HEADER} -->`;
const RUN = "https://github.com/o/r/actions/runs/909";

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
  /** Prefer the most recent (highest id) marker-bearing comment. */
  const upsert = async (body: string) => {
    const matches = comments.filter((c) => c.body.startsWith(MARKER));
    if (matches.length > 0) {
      const newest = matches.reduce((a, b) => (a.id > b.id ? a : b));
      return update(newest.id, body);
    }
    return create(body);
  };
  return { comments, create, update, upsert };
}

const fresh = () =>
  buildCoverageComment({
    runUrl: RUN,
    validateOutcome: "success",
    coverageArtifactId: "cov-NEW",
    debugBundleArtifactId: "deb-NEW",
    stepSummaryArtifactId: "step-NEW",
    failureBreakdownArtifactId: "fb-NEW",
  });

describe("sticky upsert — multiple existing marker comments", () => {
  it("updates the MOST RECENT marker comment, never creates a third", async () => {
    const api = makeApi([
      { id: 5, body: `${MARKER}\nfirst stale body — cov-OLDEST` },
      { id: 11, body: `${MARKER}\nsecond stale body — cov-OLD` },
      { id: 99, body: `${MARKER}\nthird stale body — cov-RECENT` },
    ]);
    const body = fresh();
    await api.upsert(body);

    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith(99, body);
    // Still exactly three comments — no duplicate created.
    expect(api.comments).toHaveLength(3);
    // Only the newest was rewritten; the two older stale comments are
    // left as-is (deleting them is out of scope for the upsert action).
    expect(api.comments.find((c) => c.id === 99)!.body).toBe(`${MARKER}\n${body}`);
    expect(api.comments.find((c) => c.id === 5)!.body).toContain("cov-OLDEST");
    expect(api.comments.find((c) => c.id === 11)!.body).toContain("cov-OLD");
  });

  it("multiple reruns against a thread with doubles still update the same (newest) one", async () => {
    const api = makeApi([
      { id: 2, body: `${MARKER}\nstale A` },
      { id: 8, body: `${MARKER}\nstale B (newest at start)` },
    ]);
    for (let i = 0; i < 4; i++) {
      await api.upsert(
        buildCoverageComment({
          runUrl: RUN,
          validateOutcome: "success",
          coverageArtifactId: `cov-${i}`,
          debugBundleArtifactId: `deb-${i}`,
          stepSummaryArtifactId: `step-${i}`,
          failureBreakdownArtifactId: `fb-${i}`,
        }),
      );
    }
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledTimes(4);
    expect(api.comments).toHaveLength(2);
    // The newest (id=8) ends up reflecting the LATEST rerun.
    expect(api.comments.find((c) => c.id === 8)!.body).toContain(`${RUN}/artifacts/cov-3`);
    // The older stale one is untouched.
    expect(api.comments.find((c) => c.id === 2)!.body).toBe(`${MARKER}\nstale A`);
  });
});
