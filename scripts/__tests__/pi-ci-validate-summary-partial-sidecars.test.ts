// E2E: consolidated + summary behavior when ONE sidecar is missing or
// unparseable — the other must still be reported with its exact path
// and the correct expected-vs-actual schema_version.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

const REPORT   = join(REPO_ROOT, "scripts/pretty-index-mismatch-ci-bundle-report.sh");
const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
let extracted: string;

d("consolidated summary — one sidecar missing/unparseable, other still reported", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-report-partial-"));
    extracted = join(workdir, "extracted", "pi-ci-atomic");
    mkdirSync(extracted, { recursive: true });
    writeFileSync(join(extracted, "validate-report.json"), '{"a":1}');
    writeFileSync(join(extracted, "validate-schema-assertion.txt"), "ok\n");
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("preflight-status.json missing → extracted-tree row still shows path + expected/actual", () => {
    // Regenerate sidecars, then wipe preflight-status.json.
    spawnSync("bash", [REPORT, "--dir", extracted, "atomic"], { encoding: "utf8" });
    const prePath  = join(extracted, "preflight-status.json");
    const treePath = join(extracted, "extracted-tree.json");
    rmSync(prePath, { force: true });

    // Run validator directly against the extracted dir with an expected
    // that will mismatch the surviving tree sidecar's schema_version=1.
    const r = spawnSync("bash", [VALIDATE, extracted], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "42" },
    });
    expect(r.status).not.toBe(0);

    // Header still first (survives per-file failure and missing sidecar).
    expect(r.stdout.split("\n")[0]).toBe(
      "pi-ci-validate-report-schemas: expected schema_version=42",
    );

    // Summary JSON present and lists BOTH files with correct
    // expected/actual + failing paths.
    const summaryPath = join(extracted, "report-schema-validation-summary.json");
    expect(existsSync(summaryPath)).toBe(true);
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    expect(summary.expected_schema_version).toBe("42");
    const byLabel = Object.fromEntries(
      summary.files.map((f: { label: string }) => [f.label, f]),
    );
    expect(byLabel["extracted-tree.json"]).toMatchObject({
      path: treePath,
      expected_schema_version: "42",
      actual_schema_version: "1",
      status: "FAIL",
    });
    expect(byLabel["preflight-status.json"]).toMatchObject({
      path: prePath,
      expected_schema_version: "42",
      actual_schema_version: "<missing-file>",
      status: "FAIL",
    });
  }, 60_000);

  it("extracted-tree.json unparseable → preflight row still shows path + expected/actual", () => {
    spawnSync("bash", [REPORT, "--dir", extracted, "atomic"], { encoding: "utf8" });
    const prePath  = join(extracted, "preflight-status.json");
    const treePath = join(extracted, "extracted-tree.json");
    writeFileSync(treePath, "{not json");

    const r = spawnSync("bash", [VALIDATE, extracted], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "7" },
    });
    expect(r.status).not.toBe(0);

    const summary = JSON.parse(
      readFileSync(join(extracted, "report-schema-validation-summary.json"), "utf8"),
    );
    const byLabel = Object.fromEntries(
      summary.files.map((f: { label: string }) => [f.label, f]),
    );
    // Preflight sidecar (still valid JSON with schema_version=1) shows
    // its path + drift against expected=7.
    expect(byLabel["preflight-status.json"]).toMatchObject({
      path: prePath,
      expected_schema_version: "7",
      actual_schema_version: "1",
      status: "FAIL",
    });
    // Tree sidecar is present but unparseable — the current schema
    // checker's jq stderr is suppressed so it may report OK, but the
    // summary must still carry its path so triagers can open it.
    expect(byLabel["extracted-tree.json"].path).toBe(treePath);
  }, 60_000);
});
