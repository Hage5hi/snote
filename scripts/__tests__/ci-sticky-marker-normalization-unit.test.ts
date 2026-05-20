// Unit tests for marker normalization in `hasStickyMarker`.
//
// The matcher MUST treat the following as semantically identical when
// comparing a candidate line against the configured marker:
//   - leading UTF-8 BOM (\uFEFF) on the body
//   - CRLF, LF, and bare CR line endings
//   - surrounding whitespace including tabs, NBSP (\u00A0), and em-space
//
// Both the head-scan path (default headScanLines window) and the
// full-scan path (`fullScan: true`) must agree on every input. This
// pins the contract so future "optimizations" can't silently regress
// one path relative to the other.
import { describe, expect, it } from "vitest";
import { hasStickyMarker } from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:normalization-unit -->";
const BOM = "\uFEFF";

/** Run the matcher on every code path; expect them to agree. */
function bothPaths(body: string, marker = MARKER): { head: boolean; full: boolean } {
  return {
    head: hasStickyMarker(body, marker),
    full: hasStickyMarker(body, marker, { fullScan: true }),
  };
}

describe("hasStickyMarker — marker normalization (head + full paths agree)", () => {
  it("leading BOM is ignored", () => {
    const r = bothPaths(`${BOM}${MARKER}\nbody`);
    expect(r).toEqual({ head: true, full: true });
  });

  it("CRLF, LF, and bare CR newlines all match identically", () => {
    expect(bothPaths(`${MARKER}\nbody`)).toEqual({ head: true, full: true });
    expect(bothPaths(`${MARKER}\r\nbody`)).toEqual({ head: true, full: true });
    expect(bothPaths(`${MARKER}\rbody`)).toEqual({ head: true, full: true });
    expect(bothPaths(`line1\r\n${MARKER}\r\nbody`)).toEqual({ head: true, full: true });
  });

  it("surrounding whitespace on the marker line is trimmed (spaces, tabs, NBSP, em-space)", () => {
    const cases = [
      `  ${MARKER}  \nbody`,
      `\t${MARKER}\t\nbody`,
      `\u00A0${MARKER}\u00A0\nbody`,
      `\u2003${MARKER}\u2003\nbody`,
      `\t \u00A0 ${MARKER} \u2003\t\nbody`,
    ];
    for (const body of cases) {
      const r = bothPaths(body);
      expect(r, `case: ${JSON.stringify(body)}`).toEqual({ head: true, full: true });
    }
  });

  it("BOM + CRLF + whitespace combined still matches on both paths", () => {
    const r = bothPaths(`${BOM}\t  ${MARKER} \u00A0\r\nbody`);
    expect(r).toEqual({ head: true, full: true });
  });

  it("marker buried past head window: head path misses, full path matches", () => {
    const noise = Array.from({ length: 20 }, (_, i) => `noise-${i}`).join("\r\n");
    const body = `${BOM}${noise}\r\n\t${MARKER}\u00A0\r\ntail`;
    expect(hasStickyMarker(body, MARKER)).toBe(false);
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(true);
  });

  it("truncated or mangled markers do NOT match on either path", () => {
    const cases = [
      MARKER.slice(0, -4), // missing trailing " -->"
      MARKER.replace("sticky", "Sticky"), // case-sensitive
      `${MARKER}extra`, // marker with trailing junk on same line
      `extra${MARKER}`, // marker with leading junk on same line
      `${MARKER.slice(0, 12)}\u200B${MARKER.slice(12)}`, // ZWSP inside marker
    ];
    for (const variant of cases) {
      const body = `${variant}\nbody`;
      expect(hasStickyMarker(body, MARKER), `variant: ${JSON.stringify(variant)}`).toBe(false);
      expect(
        hasStickyMarker(body, MARKER, { fullScan: true }),
        `variant (full): ${JSON.stringify(variant)}`,
      ).toBe(false);
    }
  });

  it("custom headScanLines is respected and consistent with full scan", () => {
    const body = `a\nb\nc\n${MARKER}\nd`; // marker on line 4 (index 3)
    expect(hasStickyMarker(body, MARKER, { headScanLines: 3 })).toBe(false);
    expect(hasStickyMarker(body, MARKER, { headScanLines: 4 })).toBe(true);
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(true);
  });

  it("empty / non-string / null inputs return false on both paths without throwing", () => {
    for (const v of ["", null, undefined, 0, {}, [], 123]) {
      expect(hasStickyMarker(v as unknown as string, MARKER)).toBe(false);
      expect(hasStickyMarker(v as unknown as string, MARKER, { fullScan: true })).toBe(false);
    }
  });

  it("idempotent: same input yields same answer across many calls", () => {
    const body = `${BOM}\t${MARKER}\r\nbody`;
    for (let i = 0; i < 25; i++) {
      expect(hasStickyMarker(body, MARKER)).toBe(true);
      expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(true);
    }
  });
});
