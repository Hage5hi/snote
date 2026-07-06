// E2E: set an incorrect schema_version in extracted-tree.json inside
// the shareable zip, unzip it, then run
// scripts/ci/pi-ci-validate-report-schemas.sh and assert the schema
// validator fails with exit code 5 (schema violation) AND that the
// annotation surfaces both expected and actual schema_version values.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => {
  try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; }
};
const ok = has("bash") && has("jq") && has("zip") && has("unzip") && has("make");
const d = ok ? describe : describe.skip;

// Use scope=stress so this test doesn't collide with the atomic-scope
// zip-verify test when vitest runs test files in parallel.
const SCOPE = "stress";
const bundle = join(REPO_ROOT, `_pi-ci-bundle-${SCOPE}`);
const extracted = join(bundle, "extracted", `pi-ci-${SCOPE}`);
const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

d("pi-ci schema validator — wrong schema_version in zipped extracted-tree.json", () => {
  beforeEach(() => {
    rmSync(bundle, { recursive: true, force: true });
    mkdirSync(extracted, { recursive: true });
    writeFileSync(join(extracted, "validate-report.json"), '{"a":1}');
    writeFileSync(join(extracted, "validate-schema-assertion.txt"), "ok\n");
  });
  afterEach(() => { rmSync(bundle, { recursive: true, force: true }); });

  it("fails with exit 5 and annotates expected=1/actual=<bad>", () => {
    // Build the shareable zip (regenerates schema-valid sidecars).
    expect(
      spawnSync("make", ["pretty-index-mismatch-ci-bundle-zip", `PI_CI_SCOPE=${SCOPE}`],
        { cwd: REPO_ROOT, encoding: "utf8" }).status,
    ).toBe(0);

    const zipfile = join(bundle, `pretty-index-mismatch-ci-bundle-${SCOPE}-share.zip`);
    expect(existsSync(zipfile)).toBe(true);

    // Unzip to a scratch dir and set an INVALID schema_version.
    const stage = join(bundle, ".stage-sv");
    mkdirSync(stage, { recursive: true });
    expect(spawnSync("unzip", ["-q", "-o", zipfile, "-d", stage]).status).toBe(0);
    const innerPath = join(stage, "extracted", `pi-ci-${SCOPE}`, "extracted-tree.json");
    const parsed = JSON.parse(readFileSync(innerPath, "utf8"));
    parsed.schema_version = "99";
    writeFileSync(innerPath, JSON.stringify(parsed));

    // Run the validator directly against the unzipped tree.
    const target = join(stage, "extracted", `pi-ci-${SCOPE}`);
    // preflight-status.json must exist for the validator's second check
    // to also run; it's already in the zip, so nothing extra to do.
    const r = spawnSync("bash", [VALIDATE, target], { encoding: "utf8" });
    expect(r.status).toBe(5);

    const stdout = r.stdout ?? "";
    expect(stdout).toContain("::error file=" + join(target, "extracted-tree.json"));
    expect(stdout).toContain("expected schema_version=1");
    expect(stdout).toContain("actual=99");

    const errBody = readFileSync(join(target, "report-schema-errors.txt"), "utf8");
    expect(errBody).toMatch(/schema_version: expected "1", got 99/);
  }, 60_000);
});
