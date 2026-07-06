// E2E for PI_CI_EXPECTED_SCHEMA_VERSION: when the env var is set, the
// ::error annotation from scripts/ci/pi-ci-validate-report-schemas.sh
// must reflect the configured expected value (not the hard-coded "1"),
// and the per-file schema checker must fail against that expected.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => {
  try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; }
};
const ok = has("bash") && has("jq");
const d = ok ? describe : describe.skip;

const MANIFEST = join(REPO_ROOT, "scripts/ci/pi-ci-extracted-tree-manifest.sh");
const STATUS   = join(REPO_ROOT, "scripts/ci/pi-ci-preflight-status-summary.sh");
const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
let target: string;

d("PI_CI_EXPECTED_SCHEMA_VERSION — configurable expected schema_version", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-expected-sv-"));
    target = workdir;
    writeFileSync(join(target, "validate-report.json"), '{"a":1}');
    writeFileSync(join(target, "validate-schema-assertion.txt"), "ok\n");
    expect(spawnSync("bash", [MANIFEST, target]).status).toBe(0);
    expect(
      spawnSync("bash", [STATUS, target, "atomic"], {
        env: { ...process.env, GITHUB_STEP_SUMMARY: "/dev/null" },
      }).status,
    ).toBe(0);
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("annotation reflects the configured PI_CI_EXPECTED_SCHEMA_VERSION (=2), not the default", () => {
    const r = spawnSync("bash", [VALIDATE, target], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "2" },
    });
    expect(r.status).toBe(5);

    const stdout = r.stdout ?? "";
    // Both files still carry schema_version="1" (default from
    // generation), so BOTH annotations must show expected=2, actual=1.
    expect(stdout).toContain(
      `::error file=${join(target, "extracted-tree.json")}`,
    );
    expect(stdout).toContain(
      `::error file=${join(target, "preflight-status.json")}`,
    );
    // Configured expected value flows into the annotation…
    expect(stdout).toContain("expected schema_version=2");
    expect(stdout).toContain("actual=1");
    // …and into the underlying per-file schema-check errors.
    const errBody = readFileSync(join(target, "report-schema-errors.txt"), "utf8");
    expect(errBody).toMatch(/schema_version: expected "2", got 1/);
  }, 60_000);

  it("keeps default expected=1 when env var unset (regression guard)", () => {
    const env = { ...process.env };
    delete env.PI_CI_EXPECTED_SCHEMA_VERSION;
    const r = spawnSync("bash", [VALIDATE, target], { encoding: "utf8", env });
    // Regenerated sidecars satisfy default expected="1" — no drift.
    expect(r.status).toBe(0);
  }, 30_000);
});
