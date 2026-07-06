// E2E: set an incorrect schema_version in preflight-status.json inside
// the shareable zip, unzip it, then run the schema validator and
// assert:
//   - it exits 5 (schema violation)
//   - the ::error annotation for preflight-status.json includes
//     expected schema_version=1 and actual=<bad-value>
//   - report-schema-errors.txt records the drift
//
// Builds the zip in a temp dir (calling the sidecar scripts directly,
// then `zip`) so this test doesn't collide with sibling tests that use
// the REPO_ROOT `_pi-ci-bundle-<scope>` layout expected by `make`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => {
  try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; }
};
const ok = has("bash") && has("jq") && has("zip") && has("unzip");
const d = ok ? describe : describe.skip;

const MANIFEST = join(REPO_ROOT, "scripts/ci/pi-ci-extracted-tree-manifest.sh");
const STATUS   = join(REPO_ROOT, "scripts/ci/pi-ci-preflight-status-summary.sh");
const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
let bundle: string;
let extracted: string;

d("pi-ci schema validator — wrong schema_version in zipped preflight-status.json", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-preflight-sv-"));
    bundle = join(workdir, "bundle");
    extracted = join(bundle, "extracted", "pi-ci-atomic");
    mkdirSync(extracted, { recursive: true });
    writeFileSync(join(extracted, "validate-report.json"), '{"a":1}');
    writeFileSync(join(extracted, "validate-schema-assertion.txt"), "ok\n");
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("fails with exit 5 and annotates expected=1/actual=42 for preflight-status.json", () => {
    // Regenerate schema-valid sidecars.
    expect(spawnSync("bash", [MANIFEST, extracted]).status).toBe(0);
    expect(
      spawnSync("bash", [STATUS, extracted, "atomic"], {
        env: { ...process.env, GITHUB_STEP_SUMMARY: "/dev/null" },
      }).status,
    ).toBe(0);

    // Zip the extracted layout — mimics the shareable archive.
    const zipfile = join(workdir, "share.zip");
    expect(
      spawnSync("bash", ["-c", `cd "${bundle}" && zip -qr "${zipfile}" .`]).status,
    ).toBe(0);

    // Unzip into a fresh scratch dir and set an INVALID schema_version
    // on preflight-status.json.
    const stage = join(workdir, "stage");
    mkdirSync(stage, { recursive: true });
    expect(spawnSync("unzip", ["-q", "-o", zipfile, "-d", stage]).status).toBe(0);
    const target = join(stage, "extracted", "pi-ci-atomic");
    const pfPath = join(target, "preflight-status.json");
    const parsed = JSON.parse(readFileSync(pfPath, "utf8"));
    parsed.schema_version = "42";
    writeFileSync(pfPath, JSON.stringify(parsed));

    // Run the validator against the unzipped tree.
    const r = spawnSync("bash", [VALIDATE, target], { encoding: "utf8" });
    expect(r.status).toBe(5);

    const stdout = r.stdout ?? "";
    // extracted-tree.json passes; preflight-status.json fails with the
    // schema_version drift — annotation must include expected/actual.
    expect(stdout).toContain("::error file=" + pfPath);
    expect(stdout).toContain("preflight-status.json schema check failed");
    expect(stdout).toContain("expected schema_version=1");
    expect(stdout).toContain("actual=42");

    expect(existsSync(join(target, "report-schema-errors.txt"))).toBe(true);
    const errBody = readFileSync(join(target, "report-schema-errors.txt"), "utf8");
    expect(errBody).toMatch(/schema_version: expected "1", got 42/);
  }, 60_000);
});
