// The sticky action recognizes its prior comment by an HTML-comment
// marker. Real-world comment bodies arrive with various whitespace /
// newline shapes (CRLF from Windows runners, an indented first line, a
// blank leading line, trailing whitespace, etc.). The detector we use
// in the upsert path must still find the marker — otherwise we'd
// post a NEW comment every run and duplicate forever.
//
// This pins the detector contract used by our in-memory mock and by
// any future helper extracted from it: detect by SUBSTRING after
// trimming, not strict `startsWith` on raw bytes.
import { describe, expect, it } from "vitest";

const HEADER = "i18n-cli-coverage";
const MARKER = `<!-- Sticky Pull Request Comment${HEADER} -->`;

/**
 * Robust marker detector: tolerates leading/trailing whitespace,
 * CR/LF/CRLF line endings, and the marker appearing on any of the
 * first few lines (some GitHub clients prefix metadata).
 */
export function hasStickyMarker(body: string, marker = MARKER): boolean {
  if (typeof body !== "string" || body.length === 0) return false;
  // Normalize CRLF → LF, strip leading BOM/whitespace lines.
  const normalized = body.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  // Consider the marker present if it appears in the first ~5 lines,
  // ignoring per-line leading/trailing whitespace.
  const lines = normalized.split("\n").slice(0, 5);
  return lines.some((line) => line.trim() === marker.trim());
}

describe("sticky comment marker detection — whitespace & newline tolerance", () => {
  it("matches the exact marker on its own line", () => {
    expect(hasStickyMarker(`${MARKER}\nbody`)).toBe(true);
  });

  it.each([
    ["leading spaces", `   ${MARKER}\nbody`],
    ["trailing spaces", `${MARKER}   \nbody`],
    ["both", `\t  ${MARKER}  \t\nbody`],
  ])("matches with %s around the marker", (_label, body) => {
    expect(hasStickyMarker(body)).toBe(true);
  });

  it.each([
    ["CRLF", `${MARKER}\r\nbody\r\n`],
    ["bare CR", `${MARKER}\rbody\r`],
    ["LF", `${MARKER}\nbody\n`],
    ["mixed CRLF then LF", `${MARKER}\r\nline1\nline2`],
  ])("matches across %s newlines", (_label, body) => {
    expect(hasStickyMarker(body)).toBe(true);
  });

  it.each([
    ["leading blank line", `\n${MARKER}\nbody`],
    ["leading BOM", `\uFEFF${MARKER}\nbody`],
    ["leading blank + indented", `\n  ${MARKER}\nbody`],
    ["marker on line 3", `meta\nmore\n${MARKER}\nbody`],
  ])("matches when prefixed by %s", (_label, body) => {
    expect(hasStickyMarker(body)).toBe(true);
  });

  it.each([
    ["empty string", ""],
    ["plain comment", "just a review comment"],
    ["different header marker", "<!-- Sticky Pull Request Commentother-header -->\nbody"],
    ["marker buried past first ~5 lines", `\n\n\n\n\n\n${MARKER}\nbody`],
  ])("does NOT match: %s", (_label, body) => {
    expect(hasStickyMarker(body)).toBe(false);
  });

  it("non-string input is rejected, never throws", () => {
    expect(hasStickyMarker(undefined)).toBe(false);
    expect(hasStickyMarker(null)).toBe(false);
  });
});
