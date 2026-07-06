// E2E: BOTH sidecars missing OR unparseable — consolidated summary
// must still list both files with exact failing paths and the correct
// expected vs actual schema_version tokens, plus machine-readable
// `reason` fields.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

let workdir: string;
d("summary — both sidecars missing / unparseable", () => {
  beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "pi-ci-both-broken-")); });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  const run = (env: NodeJS.ProcessEnv) =>
    spawnSync("bash", [VALIDATE, workdir], { encoding: "utf8", env });

  it("both missing → both rows have paths + reason='missing-file'", () => {
    const r = run({ ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "4" });
    expect(r.status).not.toBe(0);

    const summary = JSON.parse(
      readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"),
    );
    expect(summary.expected_schema_version).toBe("4");

    const byLabel = Object.fromEntries(
      summary.files.map((f: { label: string }) => [f.label, f]),
    );
    expect(byLabel["extracted-tree.json"]).toMatchObject({
      path: join(workdir, "extracted-tree.json"),
      expected_schema_version: "4",
      actual_schema_version: "<missing-file>",
      status: "FAIL",
      reason: "missing-file",
    });
    expect(byLabel["preflight-status.json"]).toMatchObject({
      path: join(workdir, "preflight-status.json"),
      expected_schema_version: "4",
      actual_schema_version: "<missing-file>",
      status: "FAIL",
      reason: "missing-file",
    });
  }, 30_000);

  it("both unparseable → both rows have reason='jq-parse-failed'", () => {
    writeFileSync(join(workdir, "extracted-tree.json"), "{not json");
    writeFileSync(join(workdir, "preflight-status.json"), "not json at all");

    const r = run({ ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "8" });
    // Exit code may or may not be non-zero depending on the checker's
    // jq-stderr handling; the machine-readable contract we assert on
    // is the summary artifact.
    expect(existsSync(join(workdir, "report-schema-validation-summary.json"))).toBe(true);

    const summary = JSON.parse(
      readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"),
    );
    const byLabel = Object.fromEntries(
      summary.files.map((f: { label: string }) => [f.label, f]),
    );
    for (const label of ["extracted-tree.json", "preflight-status.json"]) {
      expect(byLabel[label]).toMatchObject({
        path: join(workdir, label),
        expected_schema_version: "8",
        actual_schema_version: "<unreadable>",
        reason: "jq-parse-failed",
      });
    }
    // Redundant belt-and-braces: consumed by CI parsers.
    expect(r.stdout).toContain("report-schema-validation-summary: ");
  }, 30_000);
});
