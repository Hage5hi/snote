// E2E: stricter schema_version parsing distinguishes absent, empty-string,
// and non-numeric values while preserving the exact received value.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

function extracted(schemaVersionFragment: string) {
  return `{"schema":"pi-ci/extracted-tree/v1"${schemaVersionFragment},"generated_at":"2026-01-01T00:00:00Z","root":"/tmp/example","walk_ok":true,"content_hash":"sha256:abc","entries":[]}`;
}

function preflight(schemaVersionFragment: string) {
  return `{"schema":"pi-ci/preflight-status/v1"${schemaVersionFragment},"scope":"atomic","content_hash":"sha256:abc","validate_report":{"status":"ok","path":"validate-report.json"},"validate_schema_assertion":{"status":"ok","path":"validate-schema-assertion.txt"}}`;
}

let workdir: string;

d("summary — schema_version parsing matrix", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-schema-version-matrix-"));
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it.each([
    ["missing property", "", "schema_version-missing", "<missing>"],
    ["empty string", ',"schema_version":""', "schema_version-empty", ""],
    ["non-numeric string", ',"schema_version":"v1"', "schema_version-malformed", "v1"],
  ])("records %s as %s with exact actual value", (_name, fragment, reason, actual) => {
    writeFileSync(join(workdir, "extracted-tree.json"), extracted(fragment));
    writeFileSync(join(workdir, "preflight-status.json"), preflight(fragment));

    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "1" },
    });
    expect(r.status).not.toBe(0);

    const summary = JSON.parse(readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"));
    for (const file of summary.files) {
      expect(file).toMatchObject({
        expected_schema_version: "1",
        actual_schema_version: actual,
        status: "FAIL",
        reason,
        diff: { schema_version: { expected: "1", actual } },
      });
    }
    expect(r.stdout).toContain(`reason=${reason}`);
  }, 30_000);
});