// Property-based: generate random whitespace/newline variations around
// the sticky marker line and confirm hasStickyMarker is (a) total —
// never throws, always returns a boolean — and (b) consistent: any
// body where the marker appears on one of the first few lines after
// trimming MUST match, regardless of surrounding noise.
//
// Pure JS PRNG (no fast-check dep), 200 randomized samples per case.
import { describe, expect, it } from "vitest";
import { hasStickyMarker } from "./ci-sticky-marker-detection-whitespace.test";

const MARKER = "<!-- Sticky Pull Request Commenti18n-cli-coverage -->";

// Deterministic PRNG so failures reproduce.
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

const WS_CHARS = [" ", "\t", "\u00A0", "\u2003"]; // space, tab, NBSP, em-space
const EOL_CHARS = ["\n", "\r\n", "\r"];

function randWs(rng: () => number, max = 6): string {
  const n = Math.floor(rng() * max);
  let s = "";
  for (let i = 0; i < n; i++) s += WS_CHARS[Math.floor(rng() * WS_CHARS.length)];
  return s;
}
function randEol(rng: () => number): string {
  return EOL_CHARS[Math.floor(rng() * EOL_CHARS.length)];
}
function randPrefixLines(rng: () => number, max = 3): string {
  const n = Math.floor(rng() * max); // 0..max-1 leading blank/garbage lines
  let s = "";
  for (let i = 0; i < n; i++) s += randWs(rng) + randEol(rng);
  return s;
}

describe("hasStickyMarker — property-based whitespace/newline fuzzing", () => {
  it("200 random whitespace-padded marker bodies all detect as present", () => {
    const rng = mulberry32(0xC0FFEE);
    for (let i = 0; i < 200; i++) {
      const before = randPrefixLines(rng);
      const lead = randWs(rng);
      const trail = randWs(rng);
      const eol = randEol(rng);
      const body = `${before}${lead}${MARKER}${trail}${eol}body content ${i}`;
      let result: unknown;
      expect(() => { result = hasStickyMarker(body); }).not.toThrow();
      expect(typeof result).toBe("boolean");
      expect(result).toBe(true);
    }
  });

  it("200 random bodies WITHOUT the marker never throw and never falsely match", () => {
    const rng = mulberry32(0xBADF00D);
    for (let i = 0; i < 200; i++) {
      const before = randPrefixLines(rng, 5);
      const body = `${before}${randWs(rng)}not the marker${randEol(rng)}garbage ${i}`;
      let result: unknown;
      expect(() => { result = hasStickyMarker(body); }).not.toThrow();
      expect(typeof result).toBe("boolean");
      expect(result).toBe(false);
    }
  });

  it("detection is consistent: same body always returns the same answer", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 50; i++) {
      const body = `${randPrefixLines(rng)}${randWs(rng)}${MARKER}${randWs(rng)}${randEol(rng)}x`;
      const a = hasStickyMarker(body);
      const b = hasStickyMarker(body);
      const c = hasStickyMarker(body);
      expect(a).toBe(b);
      expect(b).toBe(c);
    }
  });

  it("never throws on adversarial inputs (control chars, very long, empty, non-string)", () => {
    const adversarial: unknown[] = [
      "",
      " ".repeat(10_000),
      "\u0000".repeat(100) + MARKER,
      MARKER + "\u0000".repeat(100),
      "\uFEFF".repeat(20) + MARKER,
      MARKER.repeat(100),
      undefined,
      null,
      123,
      {},
      [],
    ];
    for (const input of adversarial) {
      let result: unknown;
      expect(() => { result = hasStickyMarker(input as string); }).not.toThrow();
      expect(typeof result).toBe("boolean");
    }
  });
});
