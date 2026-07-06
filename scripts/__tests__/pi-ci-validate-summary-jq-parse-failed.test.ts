// E2E: jq receiving invalid JSON input must surface as
// reason="jq-parse-failed" with actual_schema_version="<unreadable>"
// on both sidecars, preserving the expected schema_version and jq
// diagnostics in the summary.
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
d("summary — jq-parse-failed reason (invalid JSON)", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-jq-parse-fail-"));
    // Non-JSON garbage — real jq will exit non-zero (not 124).
    writeFileSync(join(workdir, "extracted-tree.json"),   "{not json,,,");
    writeFileSync(join(workdir, "preflight-status.json"), "<<<invalid>>>");
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("records reason='jq-parse-failed' + actual='<unreadable>' for both sidecars", () => {
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "7" },
    });
    const summary = JSON.parse(
      readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"),
    );
    expect(summary.expected_schema_version).toBe("7");
    expect(typeof summary.jq_version).toBe("string");
    expect(summary.jq_version).not.toBe("<unavailable>");
    const byLabel = Object.fromEntries(
      summary.files.map((f: { label: string }) => [f.label, f]),
    );
    for (const label of ["extracted-tree.json", "preflight-status.json"]) {
      expect(byLabel[label]).toMatchObject({
        path: join(workdir, label),
        expected_schema_version: "7",
        actual_schema_version: "<unreadable>",
        reason: "jq-parse-failed",
      });
    }
    expect(r.stdout).toContain("reason=jq-parse-failed");
  }, 30_000);
});
