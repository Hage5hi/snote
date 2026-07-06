// E2E: end-to-end behavior of scripts/pretty-index-mismatch-ci-bundle-report.sh
// in --dir mode. Runs with PI_CI_EXPECTED_SCHEMA_VERSION=99 so the
// regenerated sidecars (schema_version=1) count as MISMATCH, and
// asserts the single consolidated summary lists:
//   - expected + actual schema_version for BOTH extracted-tree.json
//     and preflight-status.json
//   - status=MISMATCH for each
//   - the exact failing file paths
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

d("pretty-index-mismatch-ci-bundle-report — consolidated schema_version summary", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-report-consolidated-"));
    extracted = join(workdir, "extracted", "pi-ci-atomic");
    mkdirSync(extracted, { recursive: true });
    writeFileSync(join(extracted, "validate-report.json"), '{"a":1}');
    writeFileSync(join(extracted, "validate-schema-assertion.txt"), "ok\n");
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("lists expected + actual + MISMATCH + exact path for BOTH sidecars in one summary", () => {
    const r = spawnSync("bash", [REPORT, "--dir", extracted, "atomic"], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "99" },
    });

    // Schema validator exits 5 (drift). Report script forwards it.
    expect(r.status).toBe(5);

    const out = r.stdout;
    // One consolidated summary block…
    expect(out).toContain("── pretty-index-mismatch-ci consolidated report ──");
    // …with the schema_version sub-section using the configured expected.
    expect(out).toContain("── schema_version (expected=99) ──");
    // Both sidecars with actual=1 and MISMATCH status, plus their paths.
    const treePath = join(extracted, "extracted-tree.json");
    const prePath  = join(extracted, "preflight-status.json");
    expect(out).toMatch(new RegExp(`extracted-tree\\.json\\s+actual=1\\s+status=MISMATCH\\s+file=${treePath.replace(/[.\/]/g, "\\$&")}`));
    expect(out).toMatch(new RegExp(`preflight-status\\.json\\s+actual=1\\s+status=MISMATCH\\s+file=${prePath.replace(/[.\/]/g, "\\$&")}`));
  }, 60_000);
});
