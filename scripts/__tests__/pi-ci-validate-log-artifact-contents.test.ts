// E2E: CI schema-validation log artifact contents. Simulates the CI
// `tee` pipeline and asserts the uploaded log file contains:
//   - the expected schema_version header line
//   - per-file jq/schema error excerpts
//   - the ::error annotation with expected/actual schema_version values
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const ok = has("bash") && has("jq");
const d = ok ? describe : describe.skip;

const MANIFEST = join(REPO_ROOT, "scripts/ci/pi-ci-extracted-tree-manifest.sh");
const STATUS   = join(REPO_ROOT, "scripts/ci/pi-ci-preflight-status-summary.sh");
const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
let log: string;

d("CI schema-validation log artifact", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-log-artifact-"));
    log = join(workdir, "report-schema-validation-log.txt");
    writeFileSync(join(workdir, "validate-report.json"), '{"a":1}');
    writeFileSync(join(workdir, "validate-schema-assertion.txt"), "ok\n");
    expect(spawnSync("bash", [MANIFEST, workdir]).status).toBe(0);
    expect(spawnSync("bash", [STATUS, workdir, "atomic"], {
      env: { ...process.env, GITHUB_STEP_SUMMARY: "/dev/null" },
    }).status).toBe(0);
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("captures header + jq errors + expected/actual on failure", () => {
    const r = spawnSync("bash", [
      "-c",
      `: > "${log}"; bash "${VALIDATE}" "${workdir}" 2>&1 | tee "${log}"; exit "\${PIPESTATUS[0]}"`,
    ], { encoding: "utf8", env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "9" } });
    expect(r.status).toBe(5);

    const body = readFileSync(log, "utf8");
    // Header line at the very top.
    expect(body.split("\n")[0]).toBe(
      "pi-ci-validate-report-schemas: expected schema_version=9",
    );
    // Per-file jq/schema errors quoted verbatim.
    expect(body).toMatch(/schema_version: expected "9", got 1/);
    // ::error annotation with BOTH expected and actual values, for
    // each failing sidecar.
    expect(body).toContain(`::error file=${join(workdir, "extracted-tree.json")}`);
    expect(body).toContain(`::error file=${join(workdir, "preflight-status.json")}`);
    expect(body).toMatch(/expected schema_version=9, actual=1/);
  }, 60_000);
});
