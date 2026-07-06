// E2E: both expected AND actual schema_version headers are malformed
// or missing. Verifies two paths:
//   (a) expected side malformed → early-exit reason="bad-env-var"
//       with the exact received value preserved in the summary.
//   (b) actual side missing/malformed → per-file rows record
//       reason="schema_version-missing" or "schema_version-malformed"
//       with the exact received values for each side.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
d("summary — both sides malformed/missing schema_version", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-both-malformed-"));
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("(a) malformed EXPECTED aborts early with reason='bad-env-var' and echoes exact value", () => {
    writeFileSync(join(workdir, "extracted-tree.json"),   '{"schema_version":"1"}');
    writeFileSync(join(workdir, "preflight-status.json"), '{"schema_version":"1"}');
    const badExpected = "v99";
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: badExpected },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`got: '${badExpected}'`);
    const summary = JSON.parse(
      readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"),
    );
    expect(summary.reason).toBe("bad-env-var");
    expect(summary.expected_schema_version).toBe(badExpected);
    expect(summary.files).toEqual([]);
    expect(summary.exit).toBe(2);
  }, 30_000);

  it("(b) missing + malformed ACTUAL yields per-file reason='schema_version-missing'/'schema_version-malformed' with exact values", () => {
    // Left sidecar: valid JSON but no schema_version key at all → missing.
    writeFileSync(join(workdir, "extracted-tree.json"),   '{"other":"field"}');
    // Right sidecar: schema_version present but non-numeric → malformed.
    writeFileSync(join(workdir, "preflight-status.json"), '{"schema_version":"not-a-number"}');
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "1" },
    });
    const summary = JSON.parse(
      readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"),
    );
    const byLabel = Object.fromEntries(
      summary.files.map((f: { label: string }) => [f.label, f]),
    );
    expect(byLabel["extracted-tree.json"]).toMatchObject({
      expected_schema_version: "1",
      actual_schema_version: "<missing>",
      reason: "schema_version-missing",
    });
    expect(byLabel["preflight-status.json"]).toMatchObject({
      expected_schema_version: "1",
      actual_schema_version: "not-a-number",
      reason: "schema_version-malformed",
    });
    expect(r.stdout).toContain("reason=schema_version-missing");
    expect(r.stdout).toContain("reason=schema_version-malformed");
  }, 30_000);
});
