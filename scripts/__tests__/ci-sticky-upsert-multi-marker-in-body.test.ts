// Integration: a single sticky comment body carries MULTIPLE lines that
// match the marker (e.g. a previous run's body was quoted/embedded into
// a newer body, or someone pasted the marker twice). The upsert must:
//   1. Treat that comment as a single marker match (no double-counting).
//   2. Across the THREAD, still select the NEWEST comment id as the
//      one to update.
//   3. Clean up all older duplicate marker comments.
//
// This pins the contract that "multiple marker lines inside one body"
// never inflate match counts or fool the newest-wins selection.
import { describe, expect, it, vi } from "vitest";
import {
  type StickyApi,
  type StickyComment,
  upsertStickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:multi-marker-in-body -->";

function makeApi(seed: StickyComment[]) {
  const comments = seed.map((c) => ({ ...c }));
  let nextId = comments.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const api: StickyApi = {
    list: vi.fn(async () => comments.map((c) => ({ ...c }))),
    create: vi.fn(async (body: string) => {
      const c = { id: nextId++, body };
      comments.push(c);
      return { ...c };
    }),
    update: vi.fn(async (id: number, body: string) => {
      const c = comments.find((x) => x.id === id)!;
      c.body = body;
      return { ...c };
    }),
    remove: vi.fn(async (id: number) => {
      const i = comments.findIndex((x) => x.id === id);
      if (i >= 0) comments.splice(i, 1);
    }),
  };
  return { api, comments };
}

describe("upsert with multiple marker occurrences inside a single body", () => {
  it("picks the newest comment id and cleans older duplicates (markers repeated within body)", async () => {
    // Comment id=3 is the newest. Its body contains the marker on TWO
    // separate lines (e.g. the marker plus a quoted older body). The
    // other two are older duplicate sticky comments.
    const t = makeApi([
      { id: 1, body: `${MARKER}\nold body 1` },
      { id: 2, body: `${MARKER}\nold body 2\n${MARKER}\ntrailing` },
      { id: 3, body: `${MARKER}\nnewest body\n\n> quoted previous run:\n> ${MARKER}\n> previous body` },
    ]);

    const res = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "fresh body",
    });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(3); // newest wins, never id=2 just because it had two marker lines
    expect(res.cleaned.map((c) => c.id).sort()).toEqual([1, 2]);
    expect(res.cleaned.every((c) => c.via === "delete")).toBe(true);

    const sticky = t.comments.filter((c) => c.body.includes(MARKER));
    expect(sticky).toHaveLength(1);
    expect(sticky[0].id).toBe(3);
    expect(sticky[0].body).toContain("fresh body");
  });

  it("a SINGLE comment containing N marker lines still counts as one match (no spurious cleanup)", async () => {
    const t = makeApi([
      {
        id: 7,
        body: `${MARKER}\nbody\n${MARKER}\nrepeat\n${MARKER}\nthird`,
      },
    ]);
    const res = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "next",
    });
    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(7);
    expect(res.cleaned).toEqual([]); // nothing to clean — only ONE comment matched
    expect(t.api.remove).not.toHaveBeenCalled();
    expect(t.comments.filter((c) => c.body.includes(MARKER))).toHaveLength(1);
  });
});
