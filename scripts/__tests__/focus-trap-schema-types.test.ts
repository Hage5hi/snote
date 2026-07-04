// Uses the generated TS types from the published JSON Schemas so any
// drift between the CLI and the schemas surfaces as a TS/type error
// rather than a runtime surprise. If this file stops compiling, the
// generated types (and probably the schemas themselves) need updating.
import { describe, expect, it } from "vitest";
import type {
  FocusTrapInspectDiff,
  FocusTrapInspectReport,
} from "../_helpers/focus-trap-inspect-schema.types.gen";
import {
  DIFF_JSON_SCHEMA_VERSION,
  JSON_REPORT_SCHEMA_VERSION,
} from "../_helpers/focus-trap-inspect";

describe("generated schema types match CLI constants", () => {
  it("FocusTrapInspectReport.schemaVersion literal matches CLI const", () => {
    const v: FocusTrapInspectReport["schemaVersion"] = "1.0.0";
    expect(v).toBe(JSON_REPORT_SCHEMA_VERSION);
  });

  it("FocusTrapInspectDiff.schemaVersion literal matches CLI const", () => {
    const v: FocusTrapInspectDiff["schemaVersion"] = "1.0.0";
    expect(v).toBe(DIFF_JSON_SCHEMA_VERSION);
  });

  it("row shape is assignable from a well-formed literal", () => {
    const row: FocusTrapInspectDiff["rows"][number] = {
      file: "a.json",
      prevFailureReason: "",
      prevSchemaPointer: "",
      currFailureReason: "x",
      currSchemaPointer: "/y",
    };
    expect(row.file).toBe("a.json");
  });
});
