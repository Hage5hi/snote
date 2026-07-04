// Stable, snapshot-style contract on the exact `[pointer=…]` string
// the CLI appends to every schema-validation error. Downstream log
// parsers extract paths via a regex; if the format ever changes (extra
// space, different bracket, unescaped `~`) those parsers break silently.
// Also covers the tricky combined cases required by RFC 6901.
import { describe, expect, it } from "vitest";
import {
  escapeJsonPointerSegment,
  validateDiffJson,
  validateJsonReport,
} from "../_helpers/focus-trap-inspect";

// Canonical shape: single space, `[pointer=`, absolute pointer starting
// with `/`, `]` terminator. Nothing before, nothing after. Anchored.
const POINTER_SUFFIX = /^.+\s\[pointer=\/[^\]]*\]$/;
const POINTER_CAPTURE = /\s\[pointer=(\/[^\]]*)\]$/;

describe("CLI schema-validation error pointer format is stable + escaped", () => {
  it("escape helper produces canonical RFC 6901 encodings for edge cases", () => {
    const cases: Array<[string, string]> = [
      ["plain", "plain"],
      ["/", "~1"],
      ["~", "~0"],
      ["a/b", "a~1b"],
      ["a~b", "a~0b"],
      ["~1", "~01"],       // literal `~1` MUST NOT round-trip to `/`
      ["/~", "~1~0"],
      ["~/~1/~", "~0~1~01~1~0"],
      // Multi-segment / repeated escape combinations. Each pair must
      // remain order-sensitive (`~` first, then `/`) — a wrong order
      // would decode `a~1b` back to `a/b`.
      ["//", "~1~1"],
      ["~~", "~0~0"],
      ["a//b", "a~1~1b"],
      ["a~~b", "a~0~0b"],
      ["~0", "~00"],                                   // literal `~0` survives
      ["~0~1", "~00~01"],                              // interleaved literals
      ["/a/~/b/", "~1a~1~0~1b~1"],                    // trailing + inner mix
      ["a/b/c~d~e/f", "a~1b~1c~0d~0e~1f"],            // many segments in one token
      ["~/~1/~0/~", "~0~1~01~1~00~1~0"],              // combined with both literals
    ];
    for (const [input, expected] of cases) {
      expect(escapeJsonPointerSegment(input)).toBe(expected);
    }
  });

  it("every validator error ends with exactly ` [pointer=/…]`", () => {
    const errs = [
      ...validateJsonReport({ artifacts: [{}] }),
      ...validateDiffJson({ rows: [{}] }),
    ];
    expect(errs.length).toBeGreaterThan(0);
    for (const e of errs) {
      expect(e, `malformed suffix: ${e}`).toMatch(POINTER_SUFFIX);
      const p = e.match(POINTER_CAPTURE)![1];
      // No unescaped `~` (bare or followed by anything other than 0/1).
      expect(/~(?![01])/.test(p), `unescaped ~ in pointer: ${p}`).toBe(false);
      // Absolute pointer only — no `//` runs and no trailing `/`.
      expect(/\/\//.test(p), `empty segment in pointer: ${p}`).toBe(false);
      if (p !== "/") expect(p.endsWith("/"), `trailing / in pointer: ${p}`).toBe(false);
    }
  });

  it("known missing-key pointers match their exact expected string", () => {
    const errs = validateJsonReport({});
    expect(errs).toContain("missing required top-level key 'meta' [pointer=/meta]");
    expect(errs).toContain("missing required top-level key 'artifacts' [pointer=/artifacts]");
    expect(errs).toContain("missing required top-level key 'schemaVersion' [pointer=/schemaVersion]");

    const dErrs = validateDiffJson({ rows: [{}] });
    expect(dErrs).toContain("rows[0]: missing required key 'file' [pointer=/rows/0/file]");
    expect(dErrs).toContain("rows[0]: missing required key 'currSchemaPointer' [pointer=/rows/0/currSchemaPointer]");
  });
});
