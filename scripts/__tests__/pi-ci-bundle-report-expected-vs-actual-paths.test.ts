// E2E: consolidated summary must list, for BOTH extracted-tree.json
// and preflight-status.json:
//   - the exact failing file path
//   - expected schema_version (from PI_CI_EXPECTED_SCHEMA_VERSION)
//   - actual schema_version parsed from the sidecar
// so triagers see version drift + file location without opening the
// artifact.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

const REPORT = join(REPO_ROOT, "scripts/pretty-index-mismatch-ci-bundle-report.sh");

let workdir: string;
let extracted: string;

d("consolidated summary — expected vs actual schema_version + failing paths", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-report-exp-vs-actual-"));
    extracted = join(workdir, "extracted", "pi-ci-atomic");
    mkdirSync(extracted, { recursive: true });
    writeFileSync(join(extracted, "validate-report.json"), '{"a":1}');
    writeFileSync(join(extracted, "validate-schema-assertion.txt"), "ok\n");
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("lists exact path + expected + actual for each sidecar", () => {
    const r = spawnSync("bash", [REPORT, "--dir", extracted, "atomic"], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "42" },
    });
    expect(r.status).toBe(5);

    const out = r.stdout;
    const treePath = join(extracted, "extracted-tree.json");
    const prePath  = join(extracted, "preflight-status.json");

    // Header carries the expected value once.
    expect(out).toContain("── schema_version (expected=42) ──");

    // Per-file row: actual value + status + exact failing path.
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(out).toMatch(new RegExp(
      `extracted-tree\\.json\\s+actual=1\\s+status=MISMATCH\\s+file=${esc(treePath)}`,
    ));
    expect(out).toMatch(new RegExp(
      `preflight-status\\.json\\s+actual=1\\s+status=MISMATCH\\s+file=${esc(prePath)}`,
    ));
  }, 60_000);
});
