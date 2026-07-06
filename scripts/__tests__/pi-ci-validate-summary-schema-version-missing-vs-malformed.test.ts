// E2E: schema_version missing vs malformed — asserts the exact
// per-file reason token AND the received value fields (actual_schema_version
// preserved verbatim, expected_schema_version echoed from env).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;
const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

const validPreflight = JSON.stringify({
  schema: "pi-ci/preflight-status/v1",
  schema_version: 1,
  scope: "atomic",
  content_hash: "sha256:abc",
  validate_report: { status: "ok", path: "validate-report.json" },
  validate_schema_assertion: { status: "ok", path: "validate-schema-assertion.txt" },
});

let workdir: string;

d("summary — schema_version missing/malformed reason + received value", () => {
  beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "pi-ci-sv-missing-malformed-")); });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("missing schema_version key → reason=schema_version-missing, actual=<missing>", () => {
    writeFileSync(join(workdir, "extracted-tree.json"), JSON.stringify({ note: "no schema_version key" }));
    writeFileSync(join(workdir, "preflight-status.json"), validPreflight);
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "1" },
    });
    expect(r.status).not.toBe(0);
    const summary = JSON.parse(readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"));
    const row = summary.files.find((f: { label: string }) => f.label === "extracted-tree.json");
    expect(row).toMatchObject({
      reason: "schema_version-missing",
      actual_schema_version: "<missing>",
      expected_schema_version: "1",
    });
    expect(row.diff).toEqual({ schema_version: { expected: "1", actual: "<missing>" } });
  }, 20_000);

  it("non-numeric schema_version → reason=schema_version-malformed, actual preserved verbatim", () => {
    writeFileSync(join(workdir, "extracted-tree.json"), JSON.stringify({ schema_version: "v2-beta" }));
    writeFileSync(join(workdir, "preflight-status.json"), validPreflight);
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "1" },
    });
    expect(r.status).not.toBe(0);
    const summary = JSON.parse(readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"));
    const row = summary.files.find((f: { label: string }) => f.label === "extracted-tree.json");
    expect(row).toMatchObject({
      reason: "schema_version-malformed",
      actual_schema_version: "v2-beta",
      expected_schema_version: "1",
    });
    expect(row.diff).toEqual({ schema_version: { expected: "1", actual: "v2-beta" } });
  }, 20_000);
});
