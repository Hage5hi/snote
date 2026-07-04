// Generates real --json-report and --diff-json-out artifacts from a
// tiny fixture and validates each against the published JSON Schema
// under schemas/. Any drift between the CLI output and the schema
// fails the test — keeping consumers safe when they pin schemaVersion.
import Ajv from "ajv";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CSV_COLUMNS } from "../_helpers/focus-trap-inspect";

const reportSchema = JSON.parse(readFileSync("schemas/focus-trap-inspect-report.schema.json", "utf8"));
const diffSchema   = JSON.parse(readFileSync("schemas/focus-trap-inspect-diff.schema.json", "utf8"));

function csvRow(file: string, failureReason: string): string {
  return CSV_COLUMNS.map((c) => {
    if (c === "file") return file;
    if (c === "failureReason") return /[",\n\r]/.test(failureReason) ? `"${failureReason.replace(/"/g, '""')}"` : failureReason;
    return "";
  }).join(",");
}

function seed(root: string) {
  const scan = join(root, "test-results");
  const mk = (spec: string, payload: unknown | string) => {
    const d = join(scan, spec); mkdirSync(d, { recursive: true });
    const f = join(d, "focus-trap-escape-x.json");
    writeFileSync(f, typeof payload === "string" ? payload : JSON.stringify(payload));
    return f;
  };
  const fA = mk("a-spec-chromium-retry0", { focusHistory: [{ event: 42 }] });
  const fB = mk("b-spec-chromium-retry0", { focusHistory: [{ event: "keydown" }] });
  const prev = join(root, "prev"); mkdirSync(prev, { recursive: true });
  writeFileSync(join(prev, "focus-trap-inspect-summary.valid.csv"),
    [CSV_COLUMNS.join(","), csvRow(fB, ""), csvRow(fA, "")].join("\n") + "\n");
  return { scan, prev };
}

describe("focus-trap-inspect JSON Schemas", () => {
  const ajv = new Ajv({ allErrors: true });
  const validateReport = ajv.compile(reportSchema);
  const validateDiff = ajv.compile(diffSchema);

  it("compiles both published schemas", () => {
    expect(typeof validateReport).toBe("function");
    expect(typeof validateDiff).toBe("function");
  });

  it("--json-report output validates against focus-trap-inspect-report.schema.json", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-schema-report-"));
    const { scan } = seed(root);
    const out = join(root, "report.json");
    const res = spawnSync("bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--scan-root", scan,
        "--out", join(root, "summary.json"),
        "--json-report", out,
        "--invalid-dir", join(root, "_invalid")],
      { encoding: "utf8" });
    expect(res.status).toBe(2); // invalid artifact present
    const doc = JSON.parse(readFileSync(out, "utf8"));
    const ok = validateReport(doc);
    expect(ok, JSON.stringify(validateReport.errors, null, 2)).toBe(true);
    expect(doc.schemaVersion).toBe(reportSchema.properties.schemaVersion.const);
  }, 60_000);

  it("--diff-json-out output validates against focus-trap-inspect-diff.schema.json", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-schema-diff-"));
    const { scan, prev } = seed(root);
    const out = join(root, "diff.json");
    const res = spawnSync("bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--scan-root", scan,
        "--out", join(root, "summary.json"),
        "--diff-with", prev,
        "--diff-json-out", out,
        "--invalid-dir", join(root, "_invalid")],
      { encoding: "utf8" });
    expect(res.status).toBe(2);
    const doc = JSON.parse(readFileSync(out, "utf8"));
    const ok = validateDiff(doc);
    expect(ok, JSON.stringify(validateDiff.errors, null, 2)).toBe(true);
    expect(doc.schemaVersion).toBe(diffSchema.properties.schemaVersion.const);
  }, 60_000);
});
