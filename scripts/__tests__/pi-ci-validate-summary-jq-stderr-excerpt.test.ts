// E2E: jq-parse-failed rows include a short jq stderr excerpt and a
// pointer to the captured stderr file, so triagers can spot parse causes
// directly from report-schema-validation-summary.json.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

const validPreflight = JSON.stringify({
  schema: "pi-ci/preflight-status/v1",
  schema_version: 1,
  scope: "atomic",
  content_hash: "sha256:abc",
  validate_report: { status: "ok", path: "validate-report.json" },
  validate_schema_assertion: { status: "ok", path: "validate-schema-assertion.txt" },
});

let workdir: string;

d("summary — jq stderr excerpt", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-jq-stderr-"));
    writeFileSync(join(workdir, "extracted-tree.json"), "{not json,,,");
    writeFileSync(join(workdir, "preflight-status.json"), validPreflight);
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("records jq_stderr_excerpt and jq_stderr_path for the failing per-file entry", () => {
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "1" },
    });
    expect(r.status).not.toBe(0);

    const summary = JSON.parse(readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"));
    const byLabel = Object.fromEntries(summary.files.map((f: { label: string }) => [f.label, f]));
    expect(byLabel["extracted-tree.json"]).toMatchObject({
      expected_schema_version: "1",
      actual_schema_version: "<unreadable>",
      reason: "jq-parse-failed",
    });
    expect(byLabel["extracted-tree.json"].jq_stderr_excerpt).toMatch(/parse error/i);
    expect(byLabel["extracted-tree.json"].jq_stderr_path).toContain("report-schema-jq-extracted-tree-json.stderr.txt");
    expect(existsSync(byLabel["extracted-tree.json"].jq_stderr_path)).toBe(true);
    expect(byLabel["preflight-status.json"].reason).toBe("ok");
    expect(byLabel["preflight-status.json"].jq_stderr_excerpt).toBeNull();
  }, 30_000);
});