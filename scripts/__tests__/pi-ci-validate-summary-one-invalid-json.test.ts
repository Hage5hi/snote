// E2E: if only one sidecar is invalid JSON, the consolidated summary still
// reports both exact paths and expected/actual schema_version values.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

const validExtracted = JSON.stringify({
  schema: "pi-ci/extracted-tree/v1",
  schema_version: 1,
  generated_at: "2026-01-01T00:00:00Z",
  root: "/tmp/example",
  walk_ok: true,
  content_hash: "sha256:abc",
  entries: [],
});

const validPreflight = JSON.stringify({
  schema: "pi-ci/preflight-status/v1",
  schema_version: 1,
  scope: "atomic",
  content_hash: "sha256:abc",
  validate_report: { status: "ok", path: "validate-report.json" },
  validate_schema_assertion: { status: "ok", path: "validate-schema-assertion.txt" },
});

let workdir: string;

d("summary — exactly one sidecar has invalid JSON", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-one-invalid-json-"));
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it.each([
    ["extracted-tree.json", "preflight-status.json", validPreflight],
    ["preflight-status.json", "extracted-tree.json", validExtracted],
  ])("reports jq-parse-failed for %s and preserves the OK row for %s", (badLabel, okLabel, okJson) => {
    writeFileSync(join(workdir, badLabel), "{not json,,,");
    writeFileSync(join(workdir, okLabel), okJson);

    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "1" },
    });
    expect(r.status).not.toBe(0);

    const summary = JSON.parse(readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"));
    const byLabel = Object.fromEntries(summary.files.map((f: { label: string }) => [f.label, f]));
    expect(byLabel[badLabel]).toMatchObject({
      path: join(workdir, badLabel),
      expected_schema_version: "1",
      actual_schema_version: "<unreadable>",
      status: "FAIL",
      reason: "jq-parse-failed",
    });
    expect(byLabel[okLabel]).toMatchObject({
      path: join(workdir, okLabel),
      expected_schema_version: "1",
      actual_schema_version: "1",
      status: "OK",
      reason: "ok",
    });
  }, 30_000);
});