// E2E: the CI-style validation log artifact must include enough jq
// diagnostics to reproduce jq-parse-failed failures, including jq_version,
// the literal PI_CI_JQ_BIN value, and the full jq command line with a
// timeout prefix when PI_CI_JQ_TIMEOUT_SECS is configured.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") && has("timeout") ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
let log: string;

d("CI schema-validation artifact — jq diagnostics", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-jq-artifact-"));
    log = join(workdir, "report-schema-validation-log.txt");
    writeFileSync(join(workdir, "extracted-tree.json"), "{not json,,,");
    writeFileSync(join(workdir, "preflight-status.json"), "<<<invalid>>>");
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("captures jq_version, PI_CI_JQ_BIN, and full timeout-prefixed jq_cmdline on jq-parse-failed", () => {
    const jqPath = spawnSync("sh", ["-c", "command -v jq"], { encoding: "utf8" }).stdout.trim();
    const r = spawnSync("bash", [
      "-c",
      `: > "${log}"; bash "${VALIDATE}" "${workdir}" 2>&1 | tee "${log}"; exit "\${PIPESTATUS[0]}"`,
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        PI_CI_EXPECTED_SCHEMA_VERSION: "1",
        PI_CI_JQ_BIN: jqPath,
        PI_CI_JQ_TIMEOUT_SECS: "9",
      },
    });

    expect(r.status).not.toBe(0);
    const body = readFileSync(log, "utf8");
    expect(body).toContain("pi-ci-validate-report-schemas: jq_version=jq-");
    expect(body).toContain(`pi-ci-validate-report-schemas: PI_CI_JQ_BIN=${jqPath}`);
    expect(body).toContain(`jq_cmdline=timeout 9 ${jqPath} -r`);
    expect(body).toContain(join(workdir, "extracted-tree.json"));
    expect(body).toContain(join(workdir, "preflight-status.json"));
    expect(body).toContain("reason=jq-parse-failed");
  }, 30_000);
});