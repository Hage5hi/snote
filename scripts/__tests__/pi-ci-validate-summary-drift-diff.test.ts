// E2E: schema-drift must surface an expected-vs-actual `diff` context
// both in the JSON summary and in the console output — so triagers
// see the field-level diff without opening the JSON.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

const MANIFEST = join(REPO_ROOT, "scripts/ci/pi-ci-extracted-tree-manifest.sh");
const STATUS   = join(REPO_ROOT, "scripts/ci/pi-ci-preflight-status-summary.sh");
const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
d("summary — schema-drift diff context", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-drift-diff-"));
    writeFileSync(join(workdir, "validate-report.json"), '{"a":1}');
    writeFileSync(join(workdir, "validate-schema-assertion.txt"), "ok\n");
    expect(spawnSync("bash", [MANIFEST, workdir]).status).toBe(0);
    expect(spawnSync("bash", [STATUS, workdir, "atomic"], {
      env: { ...process.env, GITHUB_STEP_SUMMARY: "/dev/null" },
    }).status).toBe(0);
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("emits files[].diff and a console diff block for schema-drift", () => {
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "7" },
    });
    expect(r.status).toBe(5);

    const summary = JSON.parse(
      readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"),
    );
    for (const f of summary.files) {
      expect(f.reason).toBe("schema-drift");
      expect(f.diff).toEqual({
        schema_version: { expected: "7", actual: "1" },
      });
    }
    // Console diff block for each file.
    expect(r.stdout).toContain("── extracted-tree.json drift diff ──");
    expect(r.stdout).toContain("── preflight-status.json drift diff ──");
    expect(r.stdout).toMatch(/schema_version:\s+expected=7\s+actual=1/);
  }, 60_000);
});
