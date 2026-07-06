// E2E: simulate the CI `tee` pattern and assert that
// report-schema-validation-log.txt ALWAYS starts with the expected
// schema_version line — even when sidecars are missing or
// extracted-tree.json is not valid JSON. This protects the log
// header contract the CI workflow depends on.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => {
  try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; }
};
const ok = has("bash");
const d = ok ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
let log: string;

const runTee = (env: NodeJS.ProcessEnv) =>
  spawnSync(
    "bash",
    [
      "-c",
      `: > "${log}"; bash "${VALIDATE}" "${workdir}" 2>&1 | tee "${log}"; exit "\${PIPESTATUS[0]}"`,
    ],
    { encoding: "utf8", env },
  );

d("report-schema-validation-log.txt — always starts with expected schema_version", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-validate-log-"));
    log = join(workdir, "report-schema-validation-log.txt");
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("header present when both sidecars are missing", () => {
    const r = runTee({ ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "7" });
    expect(r.status).not.toBe(0);
    const body = readFileSync(log, "utf8");
    expect(body.split("\n")[0]).toBe(
      "pi-ci-validate-report-schemas: expected schema_version=7",
    );
  }, 60_000);

  it("header present when extracted-tree.json is not valid JSON", () => {
    writeFileSync(join(workdir, "extracted-tree.json"), "{not json");
    writeFileSync(join(workdir, "preflight-status.json"), "{not json");
    const r = runTee({ ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "3" });
    expect(r.status).not.toBe(0);
    const body = readFileSync(log, "utf8");
    expect(body.split("\n")[0]).toBe(
      "pi-ci-validate-report-schemas: expected schema_version=3",
    );
  }, 60_000);
});
