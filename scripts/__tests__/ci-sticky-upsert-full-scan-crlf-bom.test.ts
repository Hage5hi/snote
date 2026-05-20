// Integration: full-body fallback scan must still tolerate CRLF line
// endings, a leading UTF-8 BOM, and whitespace/NBSP padding around the
// sticky marker. Markers are buried past the head-scan window so the
// fast path returns zero matches and the full-scan fallback is forced
// to engage — proving the matcher's normalization is consistent on
// both code paths, and that the newest match is still chosen + older
// duplicates cleaned.
import { describe, expect, it, vi } from "vitest";
import {
  MARKER_HEAD_SCAN_LINES,
  upsertStickyComment,
  type StickyApi,
  type StickyComment,
} from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:full-scan-crlf-bom -->";
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

/** Build a body whose marker is at `depth` lines from the top, with
 *  CRLF endings, a leading BOM, and tab/NBSP padding on the marker line. */
function buried(depth: number, tail: string): string {
  const noise = Array.from({ length: depth }, (_, i) => `noise-${i}`).join("\r\n");
  return `${BOM}${noise}\r\n\t  ${MARKER} \u00A0\r\n${tail}\r\n`;
}

describe("full-scan fallback tolerates CRLF + BOM + whitespace around marker", () => {
  it("buried-past-head marker with CRLF/BOM/whitespace: full scan rescues, newest wins, older cleaned", async () => {
    const t = makeApi([
      { id: 100, body: buried(20, "older body") },
      { id: 200, body: buried(20, "middle body") },
      { id: 300, body: buried(20, "newest body") },
    ]);

    const res = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "fresh content",
      headScanLines: 5, // deliberately smaller than burial depth
    });

    expect(res.action).toBe("updated");
    expect(res.usedFullScan).toBe(true);
    expect(res.comment.id).toBe(300);
    expect(res.cleaned.map((c) => c.id).sort((a, b) => a - b)).toEqual([100, 200]);
    expect(t.state.map((c) => c.id)).toEqual([300]);
    // Both paths walked: head = 5 lines × 3 comments; full = 22 lines × 3
    // (20 noise + 1 marker + 1 trailing body line; the trailing CRLF
    // produces a final empty line which split('\n') keeps).
    expect(res.scanStats.pagesWalked).toBe(1);
    expect(res.scanStats.commentsExamined).toBe(3);
    expect(res.scanStats.linesScanned).toBe(MARKER_HEAD_SCAN_LINES * 3 + 22 * 3);
  });

  it("mixed: one buried CRLF+BOM marker, one comment without marker — full scan still picks correct one", async () => {
    const t = makeApi([
      { id: 7, body: `${BOM}plain noise without marker\r\nmore noise\r\nstill nothing` },
      { id: 9, body: buried(10, "the real sticky") },
    ]);

    const res = await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 3,
    });

    expect(res.action).toBe("updated");
    expect(res.usedFullScan).toBe(true);
    expect(res.comment.id).toBe(9);
    expect(res.cleaned).toEqual([]); // only one true match
    expect(t.state.find((c) => c.id === 9)!.body).toBe("fresh");
  });

  it("debug log reports linesScanned across both head-scan and full-scan paths", async () => {
    const t = makeApi([{ id: 1, body: buried(8, "tail") }]);
    const lines: string[] = [];
    await upsertStickyComment({
      api: t.api,
      marker: MARKER,
      body: "fresh",
      headScanLines: 3,
      debug: (l) => lines.push(l),
    });

    const head = lines.find((l) => l.startsWith("head-scan:"));
    const full = lines.find((l) => l.startsWith("full-scan fallback:"));
    expect(head).toMatch(/matches=0/);
    expect(full).toMatch(/engaged=true/);
    expect(full).toMatch(/matches=1/);
  });
});
