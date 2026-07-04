// CLI validators must include a JSON Pointer path (RFC 6901) to the
// failing field in each error string, not just the received/expected
// values. Downstream automation greps these pointers to group failures
// by field — losing them would break triage bots.
import { describe, expect, it } from "vitest";
import { validateDiffJson, validateJsonReport } from "../_helpers/focus-trap-inspect";

const POINTER = /\[pointer=(\/[^\]]*)\]/;

describe("focus-trap-inspect validators — JSON Pointer in error messages", () => {
  it("every validateJsonReport error names the failing pointer", () => {
    const bad = {
      schemaVersion: "9.9.9",
      // scanned/matched/valid/invalid/issues missing → per-key errors
      meta: {}, artifacts: [{ /* missing all required artifact keys */ }],
    };
    const errs = validateJsonReport(bad);
    expect(errs.length).toBeGreaterThan(0);
    for (const e of errs) expect(e, `no pointer in: ${e}`).toMatch(POINTER);
    const pointers = errs.map((e) => e.match(POINTER)![1]);
    expect(pointers).toContain("/schemaVersion");
    expect(pointers).toContain("/scanned");
    expect(pointers).toContain("/valid");
    expect(pointers.some((p) => p.startsWith("/artifacts/0/"))).toBe(true);
  });

  it("every validateDiffJson error names the failing pointer", () => {
    const bad = {
      schemaVersion: "9.9.9",
      changed: "not-a-number",
      rows: [{ file: "a.json" /* missing prev/curr keys */ }, "not-an-object"],
    };
    const errs = validateDiffJson(bad);
    expect(errs.length).toBeGreaterThan(0);
    for (const e of errs) expect(e, `no pointer in: ${e}`).toMatch(POINTER);
    const pointers = errs.map((e) => e.match(POINTER)![1]);
    expect(pointers).toContain("/schemaVersion");
    expect(pointers).toContain("/changed");
    expect(pointers).toContain("/rows/1");
    expect(pointers.some((p) => p.startsWith("/rows/0/"))).toBe(true);
  });
});
