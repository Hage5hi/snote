// E2E: with PI_CI_EXPECTED_SCHEMA_VERSION unset, the consolidated
// summary header must use the default expected schema_version=1.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => {
  try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; }
};
const ok = has("bash") && has("jq");
const d = ok ? describe : describe.skip;

const REPORT = join(REPO_ROOT, "scripts/pretty-index-mismatch-ci-bundle-report.sh");

let workdir: string;
let extracted: string;

d("pretty-index-mismatch-ci-bundle-report — default expected schema_version", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-report-default-sv-"));
    extracted = join(workdir, "extracted", "pi-ci-atomic");
    mkdirSync(extracted, { recursive: true });
    writeFileSync(join(extracted, "validate-report.json"), '{"a":1}');
    writeFileSync(join(extracted, "validate-schema-assertion.txt"), "ok\n");
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("header shows expected=1 when PI_CI_EXPECTED_SCHEMA_VERSION unset", () => {
    const env = { ...process.env };
    delete env.PI_CI_EXPECTED_SCHEMA_VERSION;
    const r = spawnSync("bash", [REPORT, "--dir", extracted, "atomic"], {
      encoding: "utf8", env,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("── schema_version (expected=1) ──");
  }, 60_000);
});
