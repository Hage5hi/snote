// Unit: BOM-position semantics for the marker matcher.
//
// Observed contract (pinned here so future "optimizations" can't
// regress it):
//   - A UTF-8 BOM (U+FEFF) at the START of the BODY is stripped before
//     scanning (real-world: some tools prepend BOM when writing files).
//   - BOM is whitespace per the ECMAScript `trim()` spec, so leading /
//     trailing BOMs on a marker line are ALSO trimmed and still match.
//     The trimmed line either equals the literal marker or it doesn't.
//   - A BOM that appears INSIDE the marker text itself MUST NOT match.
//     The marker is a literal HTML comment we control; if a candidate
//     line has BOM embedded between characters, that's almost certainly
//     a corrupted/forged marker and we'd rather miss than overwrite the
//     wrong comment.
//   - A BOM on a non-marker line is irrelevant — that line still
//     doesn't equal the marker after trimming.
import { describe, expect, it } from "vitest";
import { hasStickyMarker } from "../ci-sticky-pr-comment-upsert";

const MARKER = "<!-- sticky:bom-position -->";
const BOM = "\uFEFF";

describe("hasStickyMarker — BOM position semantics", () => {
  it("BOM at the very start of the body is stripped (head + full)", () => {
    const body = `${BOM}${MARKER}\nrest`;
    expect(hasStickyMarker(body, MARKER)).toBe(true);
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(true);
  });

  it("BOM inside the marker text (between characters) does NOT match", () => {
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

  it("BOM as leading/trailing 'whitespace' on a marker line matches (trim semantics)", () => {
    // BOM (U+FEFF) is whitespace per String.prototype.trim — so it
    // gets stripped from line ends and the line still equals the marker.
    const cases = [
      `prefix line\n${BOM}${MARKER}\ntail`,
      `prefix line\n${MARKER}${BOM}\ntail`,
      `prefix line\n${BOM}${BOM}${MARKER}${BOM}\ntail`,
    ];
    for (const body of cases) {
      expect(hasStickyMarker(body, MARKER), `head: ${JSON.stringify(body)}`).toBe(true);
      expect(
        hasStickyMarker(body, MARKER, { fullScan: true }),
        `full: ${JSON.stringify(body)}`,
      ).toBe(true);
    }
  });

  it("BOM in a non-marker line does NOT cause that line to match", () => {
    // The line with BOMs is not the marker; the actual marker on the
    // next line is what matches. This guards against a regression
    // where BOM stripping leaks into mid-line content checks.
    const body = `${BOM}not the marker line${BOM}\n${MARKER}\nrest`;
    expect(hasStickyMarker(body, MARKER)).toBe(true);
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(true);
  });

  it("BOM inside marker on an interior line also does NOT match", () => {
    const corrupted = `${MARKER.slice(0, 6)}${BOM}${MARKER.slice(6)}`;
    const body = `prefix\n${corrupted}\nrest`;
    expect(hasStickyMarker(body, MARKER)).toBe(false);
    expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(false);
  });
});
