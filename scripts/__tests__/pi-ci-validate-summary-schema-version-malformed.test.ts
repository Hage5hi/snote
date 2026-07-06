// E2E: malformed schema_version value (present but non-numeric) must
// be reported as reason="schema_version-malformed" with the exact
// received value preserved in actual_schema_version.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
d("summary — schema_version-malformed reason", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-sv-malformed-"));
    writeFileSync(join(workdir, "extracted-tree.json"),   '{"schema_version":"v2"}');
    writeFileSync(join(workdir, "preflight-status.json"), '{"schema_version":"1.0"}');
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("captures non-numeric values verbatim with reason='schema_version-malformed'", () => {
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "1" },
    });
    const summary = JSON.parse(
      readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"),
    );
    const byLabel = Object.fromEntries(
      summary.files.map((f: { label: string }) => [f.label, f]),
    );
    expect(byLabel["extracted-tree.json"]).toMatchObject({
      actual_schema_version: "v2",
      reason: "schema_version-malformed",
    });
    expect(byLabel["preflight-status.json"]).toMatchObject({
      actual_schema_version: "1.0",
      reason: "schema_version-malformed",
    });
    expect(r.stdout).toContain("reason=schema_version-malformed");
  }, 30_000);
});
