// Pins the header/shape contracts enforced by scripts/inspect-focus-trap.ts
// before it writes --json-report or --diff-out. Tests the helpers
// directly so a broken contract fails fast without spawning the CLI.
import { describe, expect, it } from "vitest";
import {
  REQUIRED_DIFF_CSV_COLUMNS,
  REQUIRED_JSON_REPORT_ARTIFACT_KEYS,
  REQUIRED_JSON_REPORT_TOP_KEYS,
  validateDiffCsvHeader,
  validateJsonReport,
} from "../_helpers/focus-trap-inspect";

describe("validateDiffCsvHeader", () => {
  it("accepts the pinned header in the pinned order", () => {
    expect(validateDiffCsvHeader([...REQUIRED_DIFF_CSV_COLUMNS])).toEqual([]);
  });

  it("reports every missing required column by name", () => {
    const errs = validateDiffCsvHeader(["file", "prevFailureReason"]);
    expect(errs.some((e) => e.includes("prevSchemaPointer"))).toBe(true);
    expect(errs.some((e) => e.includes("currFailureReason"))).toBe(true);
    expect(errs.some((e) => e.includes("currSchemaPointer"))).toBe(true);
    for (const e of errs) expect(e).toMatch(/missing required column '[^']+'/);
  });

  it("reports the first out-of-order column with expected vs got", () => {
    // Swap columns 1 and 2 while keeping the full set present.
    const bad = ["file", "prevSchemaPointer", "prevFailureReason", "currFailureReason", "currSchemaPointer"];
    const errs = validateDiffCsvHeader(bad);
    expect(errs).toContain("column 1 must be 'prevFailureReason', got 'prevSchemaPointer'");
  });

  it("reports the missing slot when a column at the front is absent", () => {
    const bad = ["prevFailureReason", "prevSchemaPointer", "currFailureReason", "currSchemaPointer"];
    const errs = validateDiffCsvHeader(bad);
    // 'file' both missing-by-name AND out-of-order at index 0.
    expect(errs).toContain("missing required column 'file'");
    expect(errs.some((e) => e.startsWith("column 0 must be 'file'"))).toBe(true);
  });
});

describe("validateJsonReport", () => {
  const goodArtifact = () => Object.fromEntries(
    REQUIRED_JSON_REPORT_ARTIFACT_KEYS.map((k) => [k, k === "failureKind" || k === "schemaPointer" ? null : "x"]),
  );
  const goodReport = () => Object.fromEntries(
    REQUIRED_JSON_REPORT_TOP_KEYS.map((k) => [
      k,
      k === "valid" || k === "invalid" || k === "scanned" || k === "matched" ? 0
        : k === "artifacts" || k === "issues" ? []
        : k === "meta" ? {} : "x",
    ]),
  );

  it("accepts a minimal well-shaped report", () => {
    expect(validateJsonReport(goodReport())).toEqual([]);
  });

  it("rejects a non-object top-level", () => {
    expect(validateJsonReport(null)).toEqual(["report must be a top-level object"]);
    expect(validateJsonReport([])).toEqual(["report must be a top-level object"]);
  });

  it("reports every missing required top-level key", () => {
    const r = goodReport();
    delete (r as Record<string, unknown>).artifacts;
    delete (r as Record<string, unknown>).meta;
    const errs = validateJsonReport(r);
    expect(errs).toContain("missing required top-level key 'artifacts'");
    expect(errs).toContain("missing required top-level key 'meta'");
  });

  it("rejects wrong types on valid/invalid counts", () => {
    const r = { ...goodReport(), valid: "1", invalid: "0" };
    const errs = validateJsonReport(r);
    expect(errs).toContain("'valid' must be a number, got string");
    expect(errs).toContain("'invalid' must be a number, got string");
  });

  it("reports each missing per-artifact required key with its index", () => {
    const bad = { ...goodArtifact() } as Record<string, unknown>;
    delete bad.schemaPointer;
    delete bad.quarantined;
    const errs = validateJsonReport({ ...goodReport(), artifacts: [goodArtifact(), bad] });
    expect(errs).toContain("artifacts[1]: missing required key 'schemaPointer'");
    expect(errs).toContain("artifacts[1]: missing required key 'quarantined'");
  });
});
