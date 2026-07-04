// Negative-path coverage for the published JSON Schemas: feed malformed
// --json-report / --diff-json-out payloads (missing required keys, wrong
// schemaVersion, mistyped rows) and assert Ajv fails deterministically
// — same error paths in the same order across runs. Consumers rely on
// this to detect drift before the CLI's own validators would.
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reportSchema = JSON.parse(readFileSync("schemas/focus-trap-inspect-report.schema.json", "utf8"));
const diffSchema = JSON.parse(readFileSync("schemas/focus-trap-inspect-diff.schema.json", "utf8"));

function compile() {
  const ajv = new Ajv({ allErrors: true });
  return { report: ajv.compile(reportSchema), diff: ajv.compile(diffSchema) };
}

function errorSignature(errs: unknown): string[] {
  const list = (errs as { instancePath: string; keyword: string; params: Record<string, unknown> }[]) ?? [];
  return list
    .map((e) => `${e.instancePath}|${e.keyword}|${JSON.stringify(e.params)}`)
    .sort();
}

describe("focus-trap-inspect JSON Schemas — negative cases", () => {
  it("rejects --json-report missing multiple required top-level keys", () => {
    const { report } = compile();
    const bad = { schemaVersion: "1.0.0", generatedAt: "2026-07-04T00:00:00Z" };
    expect(report(bad)).toBe(false);
    const missing = errorSignature(report.errors).filter((s) => s.includes("|required|"));
    for (const key of ["meta", "scanned", "matched", "valid", "invalid", "artifacts", "issues"]) {
      expect(missing.some((s) => s.includes(`"missingProperty":"${key}"`)), `expected missing '${key}'`).toBe(true);
    }
  });

  it("rejects --json-report with a wrong schemaVersion", () => {
    const { report } = compile();
    const bad = {
      schemaVersion: "9.9.9",
      generatedAt: "t", meta: { gitSha: null, scanRoot: "r", argv: [], timestamp: "t" },
      scanned: 0, matched: 0, valid: 0, invalid: 0, artifacts: [], issues: [],
    };
    expect(report(bad)).toBe(false);
    const constErr = (report.errors ?? []).find((e) => e.keyword === "const" && e.instancePath === "/schemaVersion");
    expect(constErr, "expected a const violation on /schemaVersion").toBeDefined();
    expect((constErr as { params: { allowedValue: string } }).params.allowedValue).toBe("1.0.0");
  });

  it("rejects --diff-json-out missing required keys and mistyped rows", () => {
    const { diff } = compile();
    const bad = {
      schemaVersion: "1.0.0",
      // meta, diffWith, changed, generatedAt intentionally missing
      rows: [{ file: "a.json" /* other row keys missing */ }, "not-an-object"],
    };
    expect(diff(bad)).toBe(false);
    const sig = errorSignature(diff.errors);
    for (const key of ["generatedAt", "meta", "diffWith", "changed"]) {
      expect(sig.some((s) => s.startsWith("|required|") && s.includes(`"missingProperty":"${key}"`))).toBe(true);
    }
    for (const key of ["prevFailureReason", "prevSchemaPointer", "currFailureReason", "currSchemaPointer"]) {
      expect(sig.some((s) => s.startsWith("/rows/0|required|") && s.includes(`"missingProperty":"${key}"`))).toBe(true);
    }
    expect(sig.some((s) => s.startsWith("/rows/1|type|"))).toBe(true);
  });

  it("Ajv error signature is deterministic across compilations", () => {
    const bad = { schemaVersion: "1.0.0" };
    const a = compile(); a.report(bad);
    const b = compile(); b.report(bad);
    expect(errorSignature(a.report.errors)).toEqual(errorSignature(b.report.errors));
  });
});
