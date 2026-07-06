// E2E: mutate extracted-tree.json inside the generated shareable zip,
// then run `make pretty-index-mismatch-ci-bundle-zip-verify` and assert
// it fails with exit code 3 (content_hash mismatch, per Makefile).
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

// Scope must be atomic|stress per Makefile validation. The Makefile
// resolves bundles relative to CWD, and the scripts it invokes use
// paths relative to REPO_ROOT, so the test must run make from
// REPO_ROOT — we clean up the bundle dir before + after.
const SCOPE = "atomic";
const bundle = join(REPO_ROOT, `_pi-ci-bundle-${SCOPE}`);
const extracted = join(bundle, "extracted", `pi-ci-${SCOPE}`);

d("pretty-index-mismatch-ci-bundle-zip-verify — content_hash mismatch", () => {
  beforeEach(() => {
    rmSync(bundle, { recursive: true, force: true });
    mkdirSync(extracted, { recursive: true });
    writeFileSync(join(extracted, "validate-report.json"), '{"a":1}');
    writeFileSync(join(extracted, "validate-schema-assertion.txt"), "ok\n");
  });
  afterEach(() => { rmSync(bundle, { recursive: true, force: true }); });

  it("exits 3 when extracted-tree.json inside the zip is mutated", () => {
    const env = { ...process.env };
    const zipRes = spawnSync(
      "make", ["pretty-index-mismatch-ci-bundle-zip", `PI_CI_SCOPE=${SCOPE}`],
      { cwd: REPO_ROOT, env, encoding: "utf8" },
    );
    expect(zipRes.status).toBe(0);

    const zipfile = join(bundle, `pretty-index-mismatch-ci-bundle-${SCOPE}-share.zip`);
    expect(existsSync(zipfile)).toBe(true);

    // Baseline: verify succeeds on the untouched zip.
    const baseline = spawnSync(
      "make", ["pretty-index-mismatch-ci-bundle-zip-verify", `PI_CI_SCOPE=${SCOPE}`],
      { cwd: REPO_ROOT, env, encoding: "utf8" },
    );
    expect(baseline.status).toBe(0);

    // Mutate extracted-tree.json INSIDE the zip so its content_hash no
    // longer matches the on-disk sidecar.
    const stage = join(bundle, ".stage");
    mkdirSync(stage, { recursive: true });
    expect(spawnSync("unzip", ["-q", "-o", zipfile, "-d", stage]).status).toBe(0);
    const inner = spawnSync("bash", ["-c", `find "${stage}" -type f -name extracted-tree.json | head -n1`], { encoding: "utf8" });
    const innerPath = inner.stdout.trim();
    expect(innerPath).toBeTruthy();
    const parsed = JSON.parse(readFileSync(innerPath, "utf8"));
    parsed.content_hash = "sha256:deadbeef";
    writeFileSync(innerPath, JSON.stringify(parsed));
    const rel = innerPath.slice(stage.length + 1);
    expect(spawnSync("bash", ["-c", `cd "${stage}" && zip -q "${zipfile}" "${rel}"`]).status).toBe(0);

    const mutated = spawnSync(
      "make", ["pretty-index-mismatch-ci-bundle-zip-verify", `PI_CI_SCOPE=${SCOPE}`],
      { cwd: REPO_ROOT, env, encoding: "utf8" },
    );
    expect(mutated.status).toBe(3);
    expect(mutated.stdout + mutated.stderr).toContain("content_hash mismatch");
  }, 60_000);
});
