// Type-aware schema error assertions for the jq check invoked by
// `make pretty-index-validate-report-check` (and, transitively, by
// `pretty-index-mismatch-ci`).
//
// The user-visible contract we pin here:
//   - MISSING keys print         "<key>: missing (detected: null, expected <t>)"
//   - WRONG-TYPE keys print      "<key>: wrong type (detected: <actual>, expected <t>)"
//   - A valid report exits 0 with an "OK: ..." line and no errors.
//
// This guards against future refactors of the Makefile jq block silently
// dropping the "detected: <type>" hint, which is what makes CI triage
// fast when validate-report.json regresses.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();

function runCheck(reportJson: unknown): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "pi-validate-report-"));
  const path = join(dir, "validate-report.json");
  writeFileSync(path, JSON.stringify(reportJson));
  try {
    const res = spawnSync(
      "make",
      [
        "-s",
        "pretty-index-validate-report-check",
        `VALIDATE_REPORT_JSON=${path}`,
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    return {
      status: res.status ?? -1,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VALID = {
  schema: "pretty-index-mismatch-summary-validate/v1",
  status: "ok",
  exit_code: 0,
  file: "/tmp/foo.json",
  summary_schema: "pretty-index-mismatch-summary/v1",
  note: "",
  errors: [],
};

// Skip if jq/make are unavailable (e.g. minimal CI containers). Locally
// and in the project's Linux CI runners both are present.
const hasTools = (() => {
  try {
    return (
      spawnSync("jq", ["--version"]).status === 0 &&
      spawnSync("make", ["--version"]).status === 0
    );
  } catch {
    return false;
  }
})();

const d = hasTools ? describe : describe.skip;

d("pretty-index-validate-report-check — type-aware schema errors", () => {
  it("exits 0 with 'OK' when the report matches the v1 shape", () => {
    const { status, stdout } = runCheck(VALID);
    expect(status).toBe(0);
    expect(stdout).toContain("OK:");
    expect(stdout).toContain("pretty-index-mismatch-summary-validate/v1");
  });

  it("reports MISSING keys with detected: null and the expected type", () => {
    const bad: Record<string, unknown> = { ...VALID };
    delete bad.schema;
    delete bad.errors;
    const { status, stderr } = runCheck(bad);
    expect(status).not.toBe(0); expect(stderr).toContain("Error 5");
    expect(stderr).toContain("failed schema assertion");
    expect(stderr).toContain(
      "schema: missing (detected: null, expected string)",
    );
    expect(stderr).toContain(
      "errors: missing (detected: null, expected array)",
    );
  });

  it("reports WRONG-TYPE keys with the actual detected JSON type", () => {
    const bad = {
      ...VALID,
      // string field given a number → should print detected: number
      schema: 42,
      // number field given a string → should print detected: string
      exit_code: "0",
      // array field given an object → should print detected: object
      errors: { oops: true },
    };
    const { status, stderr } = runCheck(bad);
    expect(status).not.toBe(0); expect(stderr).toContain("Error 5");
    expect(stderr).toContain(
      "schema: wrong type (detected: number, expected string)",
    );
    expect(stderr).toContain(
      "exit_code: wrong type (detected: string, expected number)",
    );
    expect(stderr).toContain(
      "errors: wrong type (detected: object, expected array)",
    );
  });

  it("reports null-valued fields as wrong type (detected: null)", () => {
    const bad = { ...VALID, note: null, file: null };
    const { status, stderr } = runCheck(bad);
    expect(status).not.toBe(0); expect(stderr).toContain("Error 5");
    expect(stderr).toContain(
      "note: wrong type (detected: null, expected string)",
    );
    expect(stderr).toContain(
      "file: wrong type (detected: null, expected string)",
    );
  });
});
