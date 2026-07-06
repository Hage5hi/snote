// E2E: schema-drift (valid numeric schema_version, but ≠ expected)
// records reason="schema-drift", populates files[].diff, and prints the
// documented `── <label> drift diff ──` block into the validator log so
// triagers can read the mismatch without opening the summary JSON.
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

d("summary — schema-drift diff context block", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-drift-block-"));
    // extracted-tree.json declares schema_version=99, but we ask for 1.
    writeFileSync(join(workdir, "extracted-tree.json"), JSON.stringify({ schema_version: 99 }));
    // Valid preflight so only extracted-tree drifts.
    writeFileSync(join(workdir, "preflight-status.json"), JSON.stringify({
      schema: "pi-ci/preflight-status/v1",
      schema_version: 1,
      scope: "atomic",
      content_hash: "sha256:abc",
      validate_report: { status: "ok", path: "validate-report.json" },
      validate_schema_assertion: { status: "ok", path: "validate-schema-assertion.txt" },
    }));
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("records diff.schema_version {expected,actual} AND emits the drift diff block", () => {
    const log = join(workdir, "validator-log.txt");
    const r = spawnSync("bash", [
      "-c",
      `bash "${VALIDATE}" "${workdir}" 2>&1 | tee "${log}"; exit "\${PIPESTATUS[0]}"`,
    ], { encoding: "utf8", env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "1" } });
    expect(r.status).not.toBe(0);

    const summary = JSON.parse(readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"));
    const row = summary.files.find((f: { label: string }) => f.label === "extracted-tree.json");
    expect(row.reason).toBe("schema-drift");
    expect(row.diff).toEqual({ schema_version: { expected: "1", actual: "99" } });

    const body = readFileSync(log, "utf8");
    expect(body).toContain("── extracted-tree.json drift diff ──");
    expect(body).toMatch(/schema_version: expected=1 {2}actual=99/);
  }, 20_000);
});
