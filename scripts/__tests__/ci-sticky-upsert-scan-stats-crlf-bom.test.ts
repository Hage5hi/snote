// Integration: scanStats and matching stay correct when prior sticky
// comments arrive with CRLF line endings, a leading UTF-8 BOM, and
// extra whitespace (tabs, NBSP) padding the marker line.
//
// The bounded head-scan + tolerant marker matcher must:
//   - still detect the marker (CRLF/BOM/whitespace are normalized)
//   - update the newest match, clean up older duplicates
//   - report scanStats.linesScanned as the SUM of head-scan lines
//     actually inspected per comment (not the body byte length, not
//     padded by CRLF expansion)
import { describe, expect, it, vi } from "vitest";
import {
  MARKER_HEAD_SCAN_LINES,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:scan-stats-crlf-bom -->";
const BOM = "\uFEFF";

function makeApi(seed: StickyComment[]) {
  const state = seed.map((c) => ({ ...c }));
  let nextId = state.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const list = vi.fn(async () => state.map((c) => ({ ...c })));
  const create = vi.fn(async (body: string) => {
    const c = { id: nextId++, body };
    state.push(c);
    return c;
  });
  const update = vi.fn(async (id: number, body: string) => {
    const c = state.find((x) => x.id === id)!;
    c.body = body;
    return { ...c };
  });
  const remove = vi.fn(async (id: number) => {
    const i = state.findIndex((x) => x.id === id);
    if (i >= 0) state.splice(i, 1);
  });
  const api: StickyApi = { list, create, update, remove };
  return { api, state, list, create, update, remove };
}

describe("scanStats + matching with CRLF / BOM / whitespace markers", () => {
  it("CRLF marker on line 1: matches on head scan, scanStats reports 1 line per matched comment", async () => {
    const t = makeApi([
      { id: 10, body: `${MARKER}\r\nbody A\r\nmore\r\n` },
      { id: 20, body: `${MARKER}\r\nbody B (newest)\r\nmore\r\n` },
    ]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(20);
    expect(res.cleaned).toEqual([{ id: 10, via: "delete" }]);
    expect(res.usedFullScan).toBe(false);
    expect(res.scanStats.pagesWalked).toBe(1);
    expect(res.scanStats.commentsExamined).toBe(2);
    // First-line match → 1 line scanned per comment, only head-scan path runs.
    expect(res.scanStats.linesScanned).toBe(2);
  });

  it("leading BOM + whitespace-padded marker: matches and scanStats stays bounded", async () => {
    const t = makeApi([
      { id: 1, body: `${BOM}\t${MARKER}  \r\nold` },
      { id: 2, body: `${BOM}  ${MARKER}\t\r\nnewest` },
    ]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(2);
    expect(res.cleaned).toHaveLength(1);
    expect(res.usedFullScan).toBe(false);
    expect(res.scanStats.linesScanned).toBe(2);
  });

  it("mixed CRLF/LF/CR + non-matching comments: linesScanned is bounded by headScanLines per comment", async () => {
    // Comment without marker: head scan walks all `headScanLines` lines.
    // Comment with marker on line 3 (after CRLF+CR+LF): head scan stops at line 3.
    const noise = "line1\r\nline2\r\nline3\nline4\rline5\nline6";
    const buried = `pre1\r\npre2\r${MARKER}\nbody`;
    const t = makeApi([
      { id: 5, body: noise },
      { id: 7, body: buried },
    ]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(7);
    expect(res.usedFullScan).toBe(false);
    // noise: scans full headScanLines (5). buried: stops at line 3.
    expect(res.scanStats.linesScanned).toBe(MARKER_HEAD_SCAN_LINES + 3);
  });

  it("marker truly absent under heavy CRLF noise: head-scan exhausts budget, full-scan engaged", async () => {
    const noiseLines = Array.from({ length: 20 }, (_, i) => `noise-${i}`).join("\r\n");
    const t = makeApi([
      { id: 1, body: `${BOM}${noiseLines}` },
      { id: 2, body: noiseLines },
    ]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });

    expect(res.action).toBe("created");
    expect(res.usedFullScan).toBe(false); // no match means fallback didn't rescue anything
    // head scan: 5 lines × 2 comments = 10
    // full scan engaged (no head matches): 20 lines × 2 = 40
    expect(res.scanStats.linesScanned).toBe(MARKER_HEAD_SCAN_LINES * 2 + 20 * 2);
  });

  it("CRLF + BOM + whitespace does not produce false-positive matches against truncated markers", async () => {
    const truncated = MARKER.slice(0, -4); // drop the trailing " -->"
    const t = makeApi([
      { id: 1, body: `${BOM}\t${truncated}\r\nold (should NOT match)` },
      { id: 2, body: `${BOM}  ${MARKER}\r\nreal newest` },
    ]);
    const res = await upsertStickyComment({ api: t.api, marker: MARKER, body: "fresh" });

    expect(res.action).toBe("updated");
    expect(res.comment.id).toBe(2);
    expect(res.cleaned).toEqual([]); // only one true match
  });
});
