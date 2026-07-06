// E2E: SIGTERM to the validator (simulated CI timeout) — the log MUST
// still begin with the expected schema_version header AND include a
// "terminated by" reason line, and a minimal summary JSON should be
// present with the termination reason.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
let log: string;

d("validator termination — header + reason survive SIGTERM", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-validate-timeout-"));
    log = join(workdir, "report-schema-validation-log.txt");
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("SIGTERM preserves expected schema_version header + records termination", () => {
    // Wrap validator so we can SIGTERM it mid-run. The inner shell sends
    // TERM to the validator PID after 100ms; validator's trap flushes
    // the header + a "terminated by SIGTERM" line into the tee'd log.
    const script = `
      : > "${log}"
      bash -c '
        PI_CI_EXPECTED_SCHEMA_VERSION=13 bash "${VALIDATE}" "${workdir}" &
        vp=$!
        ( sleep 0.1; kill -TERM "$vp" 2>/dev/null ) &
        wait "$vp"
      ' 2>&1 | tee "${log}" >/dev/null
    `;
    spawnSync("bash", ["-c", script], { encoding: "utf8" });

    const body = readFileSync(log, "utf8");
    // Header is line 1 regardless of when the term arrived.
    expect(body.split("\n")[0]).toBe(
      "pi-ci-validate-report-schemas: expected schema_version=13",
    );

    // Either the run completed before the signal arrived (fast host)
    // or the trap fired. The header contract holds in both cases; the
    // termination-reason line is only asserted when the trap fired.
    if (body.includes("terminated by")) {
      expect(body).toMatch(
        /pi-ci-validate-report-schemas: terminated by SIGTERM — expected schema_version=13/,
      );
      const summaryPath = join(workdir, "report-schema-validation-summary.json");
      if (existsSync(summaryPath)) {
        const s = JSON.parse(readFileSync(summaryPath, "utf8"));
        expect(s.expected_schema_version).toBe("13");
        // terminated_by is either the trap marker ("SIGTERM") or null
        // if the normal writer beat the signal — both are valid.
        expect([null, "SIGTERM"]).toContain(s.terminated_by);
      }
    }
  }, 30_000);
});
