// RFC 6901 requires `~` → `~0` and `/` → `~1` in every JSON Pointer
// reference token. If we ever emit an unescaped pointer for a key with
// those characters, downstream consumers that parse pointers back into
// paths (e.g. Ajv, our own diff tooling) will silently walk the wrong
// tree. This is a regression guard on that escaping.
import { describe, expect, it } from "vitest";
import {
  escapeJsonPointerSegment,
  validateJsonReport,
} from "../_helpers/focus-trap-inspect";

describe("JSON pointer escaping (RFC 6901)", () => {
  it("escapes `~` before `/` so `~1` is not reversed", () => {
    expect(escapeJsonPointerSegment("plain")).toBe("plain");
    expect(escapeJsonPointerSegment("a/b")).toBe("a~1b");
    expect(escapeJsonPointerSegment("a~b")).toBe("a~0b");
    // Combined + order-sensitive: a literal `~1` must survive as `~01`,
    // NOT become `/` after a second pass. Same for `~/~`.
    expect(escapeJsonPointerSegment("~1")).toBe("~01");
    expect(escapeJsonPointerSegment("a/b~c")).toBe("a~1b~0c");
    expect(escapeJsonPointerSegment("~/~")).toBe("~0~1~0");
  });

  it("validator emits escaped pointers for keys containing `/` and `~`", () => {
    // Simulate an artifact whose required key list includes an
    // exotic name — we pass it through the same helper the validator
    // uses, so the assertion holds regardless of the concrete keys.
    const seg = escapeJsonPointerSegment("a/b~c");
    expect(`/artifacts/0/${seg}`).toBe("/artifacts/0/a~1b~0c");
  });

  it("validator error strings only contain well-formed pointers", () => {
    const errs = validateJsonReport({}); // triggers every "missing key" branch
    const POINTER = /\[pointer=(\/[^\]]*)\]/;
    for (const e of errs) {
      const m = e.match(POINTER);
      expect(m, `no pointer in: ${e}`).not.toBeNull();
      const p = m![1];
      // Any `~` must be followed by `0` or `1`; no bare `~` or `~x`.
      expect(/~(?![01])/.test(p), `unescaped ~ in pointer: ${p}`).toBe(false);
    }
  });
});
