// Property-based: randomly place BOMs (U+FEFF) and partial marker
// substrings throughout the body and verify `hasStickyMarker` never
// returns true unless the FULL marker actually appears on its own
// (trim-equal) line within the scan window.
//
// We care about two false-positive shapes specifically:
//   (a) BOMs sprinkled INSIDE the marker text on the candidate line
//       — should NOT match (the matcher only strips a leading BOM at
//       the very start of the body, never embedded ones).
//   (b) PARTIAL marker substrings (any proper prefix/suffix/slice of
//       the marker) sitting on lines, with random BOM/whitespace
//       around them — should NOT match.
//
// Total / consistent / never-throws contract is exercised by
// ci-sticky-marker-detection-fuzz.test.ts; this file focuses on the
// false-positive surface that BOM handling could open up.
import { describe, expect, it } from "vitest";
import { hasStickyMarker } from "../ci-sticky-pr-comment-upsert";
import { fuzzSeed, runFuzzWithSeed } from "./_helpers/sticky-scan-summary";

const MARKER = "<!-- Sticky Pull Request Commenti18n-cli-coverage -->";
const BOM = "\uFEFF";

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WS = [" ", "\t", "\u00A0"];
const EOL = ["\n", "\r\n", "\r"];
const pick = <T,>(rng: () => number, xs: T[]) => xs[Math.floor(rng() * xs.length)];
const ws = (rng: () => number, max = 4) => {
  let s = "";
  for (let i = 0; i < Math.floor(rng() * max); i++) s += pick(rng, WS);
  return s;
};
const eol = (rng: () => number) => pick(rng, EOL);

/** Inject N BOMs at STRICTLY INTERIOR positions of `s` (never at the
 * very start or very end, since `trim()` treats U+FEFF as whitespace
 * and would silently strip a leading/trailing BOM — that is the
 * intentionally-tolerated case, not a false positive). */
function sprinkleBoms(rng: () => number, s: string, n: number): string {
  if (s.length < 3) return s;
  let out = s;
  for (let i = 0; i < n; i++) {
    // interior: 1..out.length-1 inclusive
    const at = 1 + Math.floor(rng() * (out.length - 1));
    out = out.slice(0, at) + BOM + out.slice(at);
  }
  return out;
}

/** A proper sub-slice of the marker (never the full thing). */
function partialMarker(rng: () => number): string {
  const len = MARKER.length;
  // pick start/end so result is a strict subset
  let a = Math.floor(rng() * len);
  let b = Math.floor(rng() * len);
  if (a > b) [a, b] = [b, a];
  if (a === 0 && b === len) b = len - 1;
  if (a === b) b = Math.min(len, a + 1);
  return MARKER.slice(a, b);
}

describe("hasStickyMarker — BOM + partial-marker false-positive fuzzing", () => {
  it("200 random bodies with BOMs embedded INSIDE the marker text never match", () => {
    const seed = fuzzSeed(0xB0FFEE);
    const rng = mulberry32(seed);
    runFuzzWithSeed({
      name: "BOM-inside-marker",
      seed,
      iterations: 200,
      rng,
      body: (rng, i, ctx) => {
        const corrupted = sprinkleBoms(rng, MARKER, 1 + Math.floor(rng() * 6));
        const body =
          ws(rng) + corrupted + ws(rng) + eol(rng) + `tail content ${i}`;
        ctx.extra = { body, corrupted };
        let r: unknown;
        expect(() => { r = hasStickyMarker(body, MARKER); }).not.toThrow();
        expect(typeof r).toBe("boolean");
        expect(r).toBe(false);
        expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(false);
      },
    });
  });

  it("200 random bodies with PARTIAL marker substrings + random BOMs never match", () => {
    const seed = fuzzSeed(0xFEEDFACE);
    const rng = mulberry32(seed);
    runFuzzWithSeed({
      name: "partial-marker+BOMs",
      seed,
      iterations: 200,
      rng,
      body: (rng, i, ctx) => {
        const partial = partialMarker(rng);
        const noisy = sprinkleBoms(rng, partial, Math.floor(rng() * 4));
        const before = Array.from(
          { length: Math.floor(rng() * 3) },
          () => ws(rng) + eol(rng),
        ).join("");
        const body =
          before + ws(rng) + noisy + ws(rng) + eol(rng) + `padding ${i}`;
        ctx.extra = { partial, noisy, body };
        let r: unknown;
        expect(() => { r = hasStickyMarker(body, MARKER); }).not.toThrow();
        expect(typeof r).toBe("boolean");
        expect(r).toBe(false);
        expect(hasStickyMarker(body, MARKER, { fullScan: true })).toBe(false);
      },
    });
  });

  it("a leading BOM at the very start of the body is the ONLY tolerated BOM placement", () => {
    // Positive control: leading BOM + clean marker still matches.
    expect(hasStickyMarker(`${BOM}${MARKER}\nx`, MARKER)).toBe(true);
    // Negative: BOM appearing inside the marker line breaks it.
    expect(hasStickyMarker(`${MARKER.slice(0, 5)}${BOM}${MARKER.slice(5)}\nx`, MARKER)).toBe(false);
    // Negative: BOM as the entire candidate line is not a marker.
    expect(hasStickyMarker(`${BOM}\nnot a marker`, MARKER)).toBe(false);
  });

  it("control: a clean marker with random surrounding noise (no BOM inside) still matches", () => {
    const rng = mulberry32(0xC0DE);
    for (let i = 0; i < 50; i++) {
      const body =
        ws(rng) + MARKER + ws(rng) + eol(rng) + `tail ${i}`;
      expect(hasStickyMarker(body, MARKER)).toBe(true);
    }
  });
});
