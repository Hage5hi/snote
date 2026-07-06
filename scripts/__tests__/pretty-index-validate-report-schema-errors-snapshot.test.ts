// Snapshot-style test that pins the ENTIRE type-aware ERROR block emitted
// by `make pretty-index-validate-report-check` when the report violates
// the v1 schema. Guards both formatting AND key ordering — the jq block
// iterates $want in insertion order (schema, status, exit_code, file,
// summary_schema, note, errors) and the reader relies on that order to
// scan failures top-down.
//
// If this snapshot legitimately needs to change (new key, renamed hint),
// update it in the same PR that changes the Makefile jq block so the
// contract stays visible in review.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();

function runCheck(reportJson: unknown): { status: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "pi-validate-report-snap-"));
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
    // Redact the tmp path so the snapshot is stable across machines.
    const stderr = (res.stderr ?? "").replaceAll(path, "<REPORT>");
    return { status: res.status ?? -1, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

d("pretty-index-validate-report-check — ERROR block snapshot", () => {
  it("emits the full type-aware ERROR block in schema key order", () => {
    // Craft a report that trips one problem per key type, in every slot,
    // so the snapshot pins BOTH the missing-vs-wrong-type wording AND
    // the top-to-bottom ordering (schema→status→exit_code→file→
    // summary_schema→note→errors).
    const bad = {
      // schema: missing
      status: 123, // wrong type: number, expected string
      // exit_code: missing
      file: null, // wrong type: null, expected string
      summary_schema: [], // wrong type: array, expected string
      note: { x: 1 }, // wrong type: object, expected string
      errors: "nope", // wrong type: string, expected array
    };
    const { status, stderr } = runCheck(bad);
    // `make` normalizes any recipe failure to exit=2; the underlying jq
    // `exit 5` shows up in the stderr `Error 5` line pinned below.
    expect(status).not.toBe(0);

    expect(stderr).toMatchInlineSnapshot(`
      "ERROR: validate-report.json failed schema assertion (path=<REPORT>):
        - schema: missing (detected: null, expected string)
        - status: wrong type (detected: number, expected string)
        - exit_code: missing (detected: null, expected number)
        - file: wrong type (detected: null, expected string)
        - summary_schema: wrong type (detected: array, expected string)
        - note: wrong type (detected: object, expected string)
        - errors: wrong type (detected: string, expected array)
        expected keys: schema(string) status(string) exit_code(number) file(string) summary_schema(string) note(string) errors(array)
      make: *** [Makefile:435: pretty-index-validate-report-check] Error 5
      "
    `);
  });
});
