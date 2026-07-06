// E2E: corrupt extracted-tree.json, run the schema validator, and
// assert the orchestrator (scripts/ci/pi-ci-validate-report-schemas.sh):
//   - exits non-zero
//   - writes <out>/report-schema-errors.txt with the jq/schema excerpt
//   - emits a GitHub Actions ::error annotation that points AT the bad
//     file path AND at report-schema-errors.txt with a short excerpt
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const MANIFEST = join(REPO_ROOT, "scripts/ci/pi-ci-extracted-tree-manifest.sh");
const STATUS   = join(REPO_ROOT, "scripts/ci/pi-ci-preflight-status-summary.sh");
const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

const hasBash = (() => { try { return spawnSync("bash", ["--version"]).status === 0; } catch { return false; } })();
const hasJq   = (() => { try { return spawnSync("jq",   ["--version"]).status === 0; } catch { return false; } })();
const d = hasBash && hasJq ? describe : describe.skip;

let workdir: string;
let out: string;

function seedHealthyBundle() {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "validate-report.json"), '{"a":1}');
  writeFileSync(join(out, "validate-schema-assertion.txt"), "ok\n");
  expect(spawnSync("bash", [MANIFEST, out], { encoding: "utf8" }).status).toBe(0);
  expect(
    spawnSync("bash", [STATUS, out, "atomic"], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: "/dev/null" },
    }).status,
  ).toBe(0);
}

d("pi-ci-validate-report-schemas — corrupted extracted-tree.json", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-validate-corrupt-"));
    out = join(workdir, "pi-ci-atomic");
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("passes on a healthy bundle (baseline)", () => {
    seedHealthyBundle();
    const r = spawnSync("bash", [VALIDATE, out], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(existsSync(join(out, "report-schema-errors.txt"))).toBe(true);
  });

  it("exits non-zero, writes report-schema-errors.txt, and annotates with excerpt+pointer", () => {
    seedHealthyBundle();

    // Corrupt extracted-tree.json — valid JSON but schema-invalid (wrong
    // top-level shape + entries type). Triggers the manifest schema check.
    writeFileSync(
      join(out, "extracted-tree.json"),
      JSON.stringify({ schema: "wrong/v0", entries: "not-an-array" }),
    );

    const r = spawnSync("bash", [VALIDATE, out], { encoding: "utf8" });
    expect(r.status).not.toBe(0);

    const errPath = join(out, "report-schema-errors.txt");
    expect(existsSync(errPath)).toBe(true);
    const errBody = readFileSync(errPath, "utf8");
    expect(errBody).toContain("extracted-tree.json");
    expect(errBody).toContain("failed schema check");

    // GitHub Actions annotation is emitted on stdout.
    const stdout = r.stdout ?? "";
    expect(stdout).toContain("::error file=" + join(out, "extracted-tree.json"));
    expect(stdout).toContain("schema check failed");
    expect(stdout).toContain("report-schema-errors.txt");
    // Excerpt marker — annotation must carry a jq/schema hint inline.
    expect(stdout).toMatch(/excerpt: .+/);
  });
});
