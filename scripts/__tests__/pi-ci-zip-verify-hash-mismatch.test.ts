// E2E: mutate extracted-tree.json inside the generated shareable zip,
// then run `make pretty-index-mismatch-ci-bundle-zip-verify` and assert
// it fails with exit code 3 (content_hash mismatch, per Makefile).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();

const has = (bin: string) => {
  try { return spawnSync(bin, ["--version"]).status === 0; } catch { return false; }
};
const ok = has("bash") && has("jq") && has("zip") && has("unzip") && has("make");
const d = ok ? describe : describe.skip;

let workdir: string;

d("pretty-index-mismatch-ci-bundle-zip-verify — content_hash mismatch", () => {
  beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "pi-ci-zip-verify-")); });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("exits 3 when extracted-tree.json inside the zip is mutated", () => {
    // Seed a fake downloaded bundle layout the Makefile targets expect.
    const scope = "atomic";
    const bundle = join(workdir, `_pi-ci-bundle-${scope}`);
    const extracted = join(bundle, "extracted", `pi-ci-${scope}`);
    mkdirSync(extracted, { recursive: true });
    writeFileSync(join(extracted, "validate-report.json"), '{"a":1}');
    writeFileSync(join(extracted, "validate-schema-assertion.txt"), "ok\n");

    const env = { ...process.env, PI_CI_SCOPE: scope };
    // Build the shareable zip.
    const zipRes = spawnSync(
      "make", ["-C", REPO_ROOT, "pretty-index-mismatch-ci-bundle-zip", `PI_CI_SCOPE=${scope}`],
      { cwd: workdir, env, encoding: "utf8" },
    );
    expect(zipRes.status).toBe(0);

    const zipfile = join(bundle, `pretty-index-mismatch-ci-bundle-${scope}-share.zip`);
    expect(existsSync(zipfile)).toBe(true);

    // Baseline: verify succeeds on the untouched zip.
    const baseline = spawnSync(
      "make", ["-C", REPO_ROOT, "pretty-index-mismatch-ci-bundle-zip-verify", `PI_CI_SCOPE=${scope}`],
      { cwd: workdir, env, encoding: "utf8" },
    );
    expect(baseline.status).toBe(0);

    // Mutate extracted-tree.json INSIDE the zip so its content_hash no
    // longer matches the on-disk sidecar.
    const stage = join(workdir, "stage");
    mkdirSync(stage, { recursive: true });
    expect(spawnSync("unzip", ["-q", "-o", zipfile, "-d", stage]).status).toBe(0);
    const inner = spawnSync("bash", ["-c", `find "${stage}" -type f -name extracted-tree.json | head -n1`], { encoding: "utf8" });
    const innerPath = inner.stdout.trim();
    expect(innerPath).toBeTruthy();
    const parsed = JSON.parse(readFileSync(innerPath, "utf8"));
    parsed.content_hash = "sha256:deadbeef";
    writeFileSync(innerPath, JSON.stringify(parsed));
    // Replace the entry inside the existing zip.
    const rel = innerPath.slice(stage.length + 1);
    expect(spawnSync("bash", ["-c", `cd "${stage}" && zip -q "${zipfile}" "${rel}"`]).status).toBe(0);

    const mutated = spawnSync(
      "make", ["-C", REPO_ROOT, "pretty-index-mismatch-ci-bundle-zip-verify", `PI_CI_SCOPE=${scope}`],
      { cwd: workdir, env, encoding: "utf8" },
    );
    expect(mutated.status).toBe(3);
    expect((mutated.stdout + mutated.stderr)).toContain("content_hash mismatch");
  }, 60_000);
});
