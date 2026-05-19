// Real-world prior comments often arrive with CRLF line endings
// (Windows runners, GitHub web UI on Windows clients) and extra
// whitespace around the marker line. Cleanup MUST still:
//
//   - identify ALL marker-bearing comments regardless of CRLF / LF
//   - update the newest one
//   - delete (or lock) all older duplicates
//   - converge the thread to exactly one sticky comment
import { describe, expect, it, vi } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";
import {
  type StickyApi,
  type StickyComment,
  upsertStickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- Sticky Pull Request Commenti18n-cli-coverage -->";
const RUN = "https://github.com/o/r/actions/runs/2026";

function makeApi(seed: StickyComment[]) {
  const comments = seed.map((c) => ({ ...c }));
  let nextId = comments.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const list = vi.fn(async () => comments.map((c) => ({ ...c })));
  const create = vi.fn(async (body: string) => {
    const c = { id: nextId++, body };
    comments.push(c);
    return { ...c };
  });
  const update = vi.fn(async (id: number, body: string) => {
    const c = comments.find((x) => x.id === id)!;
    c.body = body;
    return { ...c };
  });
  const remove = vi.fn(async (id: number) => {
    const i = comments.findIndex((x) => x.id === id);
    if (i >= 0) comments.splice(i, 1);
  });
  const api: StickyApi = { list, create, update, remove };
  return { api, comments, list, create, update, remove };
}

describe("cleanup integration — CRLF + whitespace-padded markers", () => {
  it("CRLF duplicates: newest updated, older removed, no creates", async () => {
    const t = makeApi([
      { id: 4, body: `${MARKER}\r\nstale CRLF #1\r\n` },
      { id: 8, body: `  ${MARKER}  \r\nstale CRLF #2 (indented)\r\n` },
      { id: 12, body: `\t${MARKER}\t\r\nstale CRLF #3 (newest, tab-padded)\r\n` },
      { id: 13, body: "unrelated review comment" },
    ]);

    const body = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov",
      debugBundleArtifactId: "deb",
      stepSummaryArtifactId: "step",
      failureBreakdownArtifactId: "fb",
    });
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(12);
    expect(t.create).not.toHaveBeenCalled();
    expect(t.remove).toHaveBeenCalledTimes(2);
    expect(t.remove).toHaveBeenCalledWith(4);
    expect(t.remove).toHaveBeenCalledWith(8);

    // Thread converged: newest sticky + the unrelated comment.
    expect(t.comments).toHaveLength(2);
    const sticky = t.comments.find((c) => c.id === 12)!;
    expect(sticky.body.startsWith(MARKER)).toBe(true);
    expect(sticky.body).toContain(`${RUN}/artifacts/cov`);
  });

  it("mixed CRLF + LF duplicates: cleanup still finds and removes all stale", async () => {
    const t = makeApi([
      { id: 1, body: `${MARKER}\nstale LF` },
      { id: 2, body: `${MARKER}\r\nstale CRLF` },
      { id: 3, body: `${MARKER}\rstale bare-CR` },
      { id: 9, body: ` ${MARKER} \r\nstale newest (padded CRLF)` },
    ]);
    await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });
    expect(t.remove).toHaveBeenCalledTimes(3);
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0].id).toBe(9);
  });

  it("lock strategy under CRLF: tombstones replace stale, only newest keeps the marker", async () => {
    const t = makeApi([
      { id: 1, body: `${MARKER}\r\nstale A` },
      { id: 2, body: `  ${MARKER}\r\nstale B (newest)` },
    ]);
    await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "fresh",
      cleanupStrategy: "lock",
    });
    expect(t.remove).not.toHaveBeenCalled();
    const withMarker = t.comments.filter((c) => c.body.includes(MARKER));
    expect(withMarker).toHaveLength(1);
    expect(withMarker[0].id).toBe(2);
    expect(t.comments.find((c) => c.id === 1)!.body).not.toContain(MARKER);
  });
});
