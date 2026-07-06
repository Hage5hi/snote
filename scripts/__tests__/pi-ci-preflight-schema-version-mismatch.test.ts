// E2E: set an incorrect schema_version in preflight-status.json inside
// the shareable zip, unzip it, then run the schema validator and
// assert:
//   - it exits 5 (schema violation)
//   - the ::error annotation for preflight-status.json includes
//     expected schema_version=1 and actual=<bad-value>
//   - report-schema-errors.txt records the drift
//
// Uses `make ...-zip` to build a real shareable zip (per the task
// wording "inside the zip"), then unzips to a scratch dir and runs the
// validator directly — no collision with the atomic/stress scope
// bundle dirs used by sibling tests.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => {
  try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; }
};
const ok = has("bash") && has("jq") && has("zip") && has("unzip") && has("make");
const d = ok ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");
// Use a lock file to serialize atomic-scope Makefile usage between
// this test and pi-ci-zip-verify-hash-mismatch.test.ts if the runner
// executes files concurrently. We poll for the atomic bundle dir to be
// absent before proceeding.
const SCOPE = "atomic";
const bundle = join(REPO_ROOT, `_pi-ci-bundle-${SCOPE}`);
const extracted = join(bundle, "extracted", `pi-ci-${SCOPE}`);
const LOCK = join(REPO_ROOT, `_pi-ci-bundle-${SCOPE}.lock`);

async function acquireLock(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      // O_EXCL via writeFileSync flag "wx".
      writeFileSync(LOCK, String(process.pid), { flag: "wx" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`could not acquire ${LOCK} within 60s`);
}
function releaseLock() { try { rmSync(LOCK, { force: true }); } catch {} }

let workdir: string;

d("pi-ci schema validator — wrong schema_version in zipped preflight-status.json", () => {
  beforeAll(async () => { await acquireLock(); });
  afterAll(() => { releaseLock(); });

  beforeEach(() => {
    rmSync(bundle, { recursive: true, force: true });
    mkdirSync(extracted, { recursive: true });
    writeFileSync(join(extracted, "validate-report.json"), '{"a":1}');
    writeFileSync(join(extracted, "validate-schema-assertion.txt"), "ok\n");
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-preflight-sv-"));
  });
  afterEach(() => {
    rmSync(bundle, { recursive: true, force: true });
    rmSync(workdir, { recursive: true, force: true });
  });

  it("fails with exit 5 and annotates expected=1/actual=42 for preflight-status.json", () => {
    expect(
      spawnSync("make", ["pretty-index-mismatch-ci-bundle-zip", `PI_CI_SCOPE=${SCOPE}`],
        { cwd: REPO_ROOT, encoding: "utf8" }).status,
    ).toBe(0);
    const zipfile = join(bundle, `pretty-index-mismatch-ci-bundle-${SCOPE}-share.zip`);
    expect(existsSync(zipfile)).toBe(true);

    expect(spawnSync("unzip", ["-q", "-o", zipfile, "-d", workdir]).status).toBe(0);
    const target = join(workdir, "extracted", `pi-ci-${SCOPE}`);
    const pfPath = join(target, "preflight-status.json");
    const parsed = JSON.parse(readFileSync(pfPath, "utf8"));
    parsed.schema_version = "42";
    writeFileSync(pfPath, JSON.stringify(parsed));

    const r = spawnSync("bash", [VALIDATE, target], { encoding: "utf8" });
    expect(r.status).toBe(5);

    const stdout = r.stdout ?? "";
    // The extracted-tree.json check runs first and passes; the
    // preflight-status.json check fails with schema_version drift.
    expect(stdout).toContain("::error file=" + pfPath);
    expect(stdout).toContain("preflight-status.json schema check failed");
    expect(stdout).toContain("expected schema_version=1");
    expect(stdout).toContain("actual=42");

    const errBody = readFileSync(join(target, "report-schema-errors.txt"), "utf8");
    expect(errBody).toMatch(/schema_version: expected "1", got 42/);
  }, 60_000);
});
