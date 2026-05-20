// Unit: BOM-position semantics for the marker matcher.
//
// Contract:
//   - A UTF-8 BOM (U+FEFF) at the START of the BODY is stripped before
//     scanning (real-world: some tools prepend BOM when writing files).
//   - A BOM that appears INSIDE the marker text itself MUST NOT match.
//     The marker is a literal HTML comment we control; if a candidate
//     line has BOM embedded between characters, that's almost certainly
//     a corrupted/forged marker and we'd rather miss than overwrite the
//     wrong comment.
//   - A BOM in the middle of a NON-marker line is irrelevant (it just
//     prevents that line from matching, which is the safe direction).
import { describe, expect, it } from "vitest";
import { hasStickyMarker } from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:bom-position -->";
const BOM = "\uFEFF";

describe("hasStickyMarker — BOM position semantics", () => {
  it("BOM at the very start of the body is ignored (head + full)", () => {
    const body = `${BOM}${MARKER}\nrest`;
    expect(hasStickyMarker(body, MARKER)).toBe(true);
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(true);
  });

  it("BOM inside the marker text does NOT match", () => {
    // Inject BOM between characters of the marker literal.
    const variants = [
      `${MARKER.slice(0, 4)}${BOM}${MARKER.slice(4)}`,
      `${MARKER.slice(0, 10)}${BOM}${MARKER.slice(10)}`,
      `${MARKER.slice(0, -3)}${BOM}${MARKER.slice(-3)}`,
    ];
    for (const v of variants) {
      const body = `${v}\nrest`;
      expect(hasStickyMarker(body, MARKER), `head: ${JSON.stringify(v)}`).toBe(false);
      expect(
        hasStickyMarker(body, MARKER, { fullScan: true }),
        `full: ${JSON.stringify(v)}`,
      ).toBe(false);
    }
  });

  it("BOM at the start of a NON-first line (mid-body) does NOT enable a match on that line", () => {
    // The body-level BOM strip only applies once at the very start.
    // A BOM that shows up on an interior line is treated as content,
    // so an otherwise-matching marker line preceded by BOM should NOT
    // match — protects against forged markers in quoted blocks.
    const body = `prefix line\n${BOM}${MARKER}\ntail`;
    // Whitespace trim accepts NBSP / tabs but BOM is not whitespace.
    expect(hasStickyMarker(body, MARKER)).toBe(false);
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(false);
  });

  it("BOM inside a non-marker line does not affect scanning of OTHER lines", () => {
    const body = `noise\u00A0${BOM}noise\n${MARKER}\nrest`;
    expect(hasStickyMarker(body, MARKER)).toBe(true);
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(true);
  });

  it("multiple BOMs at start: only ONE leading BOM is stripped", () => {
    // Two BOMs at the start → after stripping one, the line still
    // starts with a BOM, which (per the contract above) is content.
    const body = `${BOM}${BOM}${MARKER}\nrest`;
    expect(hasStickyMarker(body, MARKER)).toBe(false);
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(false);
  });
});
