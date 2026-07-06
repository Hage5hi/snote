// E2E: when jq exceeds PI_CI_JQ_TIMEOUT_SECS, the summary records
// reason="jq-timeout", a jq_stderr_excerpt is present (either the child's
// stderr or a synthesized "jq timed out after Ns" note), and the top-level
// jq_cmdline includes the exact `timeout <secs>` prefix so triagers can
// reproduce the run.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("timeout") ? describe : describe.skip;
const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
let fakeJq: string;

d("summary — jq timeout records excerpt + timeout-prefixed jq_cmdline", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-jq-timeout-"));
    writeFileSync(join(workdir, "extracted-tree.json"), '{"schema_version":1}');
    writeFileSync(join(workdir, "preflight-status.json"), '{"schema_version":1}');
    // Fake jq that hangs forever — `timeout 1` will kill it with exit 124.
    fakeJq = join(workdir, "fake-jq.sh");
    writeFileSync(fakeJq, "#!/usr/bin/env bash\nif [ \"$1\" = \"--version\" ]; then echo 'jq-fake-1.0'; exit 0; fi\nsleep 30\n");
    chmodSync(fakeJq, 0o755);
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("records reason=jq-timeout, excerpt, and jq_cmdline with `timeout 1` prefix", () => {
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: {
        ...process.env,
        PI_CI_EXPECTED_SCHEMA_VERSION: "1",
        PI_CI_JQ_BIN: fakeJq,
        PI_CI_JQ_TIMEOUT_SECS: "1",
      },
    });
    expect(r.status).not.toBe(0);

    const summary = JSON.parse(readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"));
    expect(summary.jq_cmdline).toContain(`timeout 1 ${fakeJq} -r`);
    expect(summary.jq_timeout_secs).toBe("1");
    for (const f of summary.files) {
      expect(f.reason).toBe("jq-timeout");
      expect(f.actual_schema_version).toBe("<timeout>");
      expect(typeof f.jq_stderr_excerpt).toBe("string");
      expect(f.jq_stderr_excerpt.length).toBeGreaterThan(0);
      expect(f.jq_stderr_path).toContain("stderr.txt");
    }
  }, 20_000);
});
