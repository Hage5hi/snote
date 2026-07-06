// E2E: PI_CI_EXPECTED_SCHEMA_VERSION validation. Empty or non-integer
// values must fail fast (exit 2) with the exact ERROR line that echoes
// the received value, so users see a real signal instead of every
// downstream check reporting "expected=<garbage>".
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
d("PI_CI_EXPECTED_SCHEMA_VERSION — invalid values fail fast", () => {
  beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "pi-ci-expected-sv-invalid-")); });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("exits 2 with exact ERROR line for empty value", () => {
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "" },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      "ERROR: PI_CI_EXPECTED_SCHEMA_VERSION must be a non-empty integer (got: '')",
    );
  }, 30_000);

  it("exits 2 with exact ERROR line for non-integer value", () => {
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "v2" },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      "ERROR: PI_CI_EXPECTED_SCHEMA_VERSION must be a non-empty integer (got: 'v2')",
    );
  }, 30_000);
});
