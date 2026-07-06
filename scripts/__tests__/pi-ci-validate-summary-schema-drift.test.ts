// E2E: force a schema_version drift by regenerating sidecars with the
// default schema_version=1, then running the validator with an expected
// value of 99. Each summary row must record reason="schema-drift" with
// the exact expected/actual pair.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

d("summary — schema-drift reason", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-drift-reason-"));
    writeFileSync(join(workdir, "validate-report.json"), '{"a":1}');
    writeFileSync(join(workdir, "validate-schema-assertion.txt"), "ok\n");
    expect(spawnSync("bash", [MANIFEST, workdir]).status).toBe(0);
    expect(
      spawnSync("bash", [STATUS, workdir, "atomic"], {
        env: { ...process.env, GITHUB_STEP_SUMMARY: "/dev/null" },
      }).status,
    ).toBe(0);
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("records reason='schema-drift' with expected=99, actual=1 for both files", () => {
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "99" },
    });
    expect(r.status).toBe(5);

    const summary = JSON.parse(
      readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"),
    );
    const byLabel = Object.fromEntries(
      summary.files.map((f: { label: string }) => [f.label, f]),
    );
    for (const label of ["extracted-tree.json", "preflight-status.json"]) {
      expect(byLabel[label]).toMatchObject({
        path: join(workdir, label),
        expected_schema_version: "99",
        actual_schema_version: "1",
        status: "FAIL",
        reason: "schema-drift",
      });
    }
    // Reason also surfaced in the console recap block + ::error line.
    expect(r.stdout).toContain("── per-file reasons ──");
    expect(r.stdout).toMatch(/extracted-tree\.json\s+status=FAIL\s+reason=schema-drift/);
    expect(r.stdout).toMatch(/preflight-status\.json\s+status=FAIL\s+reason=schema-drift/);
    expect(r.stdout).toContain("reason=schema-drift");
  }, 60_000);
});
