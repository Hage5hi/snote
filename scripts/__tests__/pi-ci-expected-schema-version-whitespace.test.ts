// E2E: PI_CI_EXPECTED_SCHEMA_VERSION=' ' (whitespace) must be rejected
// as non-integer with exit 2 and an ERROR message echoing the exact
// whitespace value received.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
d("PI_CI_EXPECTED_SCHEMA_VERSION — whitespace-only value is invalid", () => {
  beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "pi-ci-sv-ws-")); });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("exits 2 with exact ERROR line for a single space", () => {
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: " " },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      "ERROR: PI_CI_EXPECTED_SCHEMA_VERSION must be a non-empty integer (got: ' ')",
    );
  }, 30_000);
});
