// E2E: simulate a jq timeout by pointing PI_CI_JQ_BIN at a fake jq
// script that exits 124 (the standard `timeout(1)` exit code). The
// summary MUST record reason="jq-timeout" with actual="<timeout>"
// and preserve expected schema_version.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
let fakeJq: string;

d("summary — jq-timeout reason", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-jq-timeout-"));
    // Populate both sidecars with valid-looking JSON so the timeout
    // branch (not missing/empty) is the one that trips.
    writeFileSync(join(workdir, "extracted-tree.json"),   '{"schema_version":"1"}');
    writeFileSync(join(workdir, "preflight-status.json"), '{"schema_version":"1"}');
    fakeJq = join(workdir, "fake-jq");
    writeFileSync(fakeJq, "#!/usr/bin/env bash\nexit 124\n");
    chmodSync(fakeJq, 0o755);
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("records reason='jq-timeout' + actual='<timeout>' for both sidecars", () => {
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "5", PI_CI_JQ_BIN: fakeJq },
    });
    // Exit code isn't the contract here — the machine-readable summary is.
    const summary = JSON.parse(
      readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"),
    );
    expect(summary.expected_schema_version).toBe("5");
    const byLabel = Object.fromEntries(
      summary.files.map((f: { label: string }) => [f.label, f]),
    );
    for (const label of ["extracted-tree.json", "preflight-status.json"]) {
      expect(byLabel[label]).toMatchObject({
        path: join(workdir, label),
        expected_schema_version: "5",
        actual_schema_version: "<timeout>",
        reason: "jq-timeout",
      });
    }
    expect(r.stdout).toContain("reason=jq-timeout");
  }, 30_000);
});
