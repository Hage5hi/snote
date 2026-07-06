// E2E-style coverage for the CI reporting helpers when the extracted-tree
// walk/list step itself fails. The manifest helper must still leave a stable
// artifact file behind, and the preflight summary should still report the
// same OK/MISSING/EMPTY inputs a job-summary reader would see.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const MANIFEST_SCRIPT = join(REPO_ROOT, "scripts/ci/pi-ci-extracted-tree-manifest.sh");
const STATUS_SCRIPT = join(REPO_ROOT, "scripts/ci/pi-ci-preflight-status-summary.sh");

const hasBash = (() => {
  try { return spawnSync("bash", ["--version"]).status === 0; }
  catch { return false; }
})();

let workdir: string;

const d = hasBash ? describe : describe.skip;

d("pretty-index-mismatch-ci reporting — extracted-tree walk failure", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-walk-fail-"));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("keeps manifest + job-summary status stable when find fails", () => {
    const out = join(workdir, "pi-ci-atomic");
    const statusPath = join(out, "preflight-status.md");
    const fakeBin = join(workdir, "bin");
    spawnSync("bash", ["-c", `mkdir -p ${JSON.stringify(fakeBin)}`]);
    spawnSync("bash", ["-c", `cat > ${JSON.stringify(join(fakeBin, "find"))} <<'EOF'\n#!/usr/bin/env bash\necho forced-find-failure >&2\nexit 77\nEOF\nchmod +x ${JSON.stringify(join(fakeBin, "find"))}`]);

    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      GITHUB_STEP_SUMMARY: statusPath,
      PI_CI_PREFLIGHT_ANNOTATIONS: "true",
    };

    const status = spawnSync("bash", [STATUS_SCRIPT, out, "atomic"], { encoding: "utf8", env });
    expect(status.status).toBe(0);
    expect(status.stdout).toContain(`::error file=${out}/validate-report.json::preflight: validate-report.json MISSING`);
    expect(status.stdout).toContain(`::error file=${out}/validate-schema-assertion.txt::preflight: validate-schema-assertion.txt MISSING`);

    const manifest = spawnSync("bash", [MANIFEST_SCRIPT, out], { encoding: "utf8", env });
    expect(manifest.status).toBe(0);

    const manifestPath = join(out, "extracted-tree.txt");
    expect(existsSync(manifestPath)).toBe(true);

    const manifestBody = readFileSync(manifestPath, "utf8");
    expect(manifestBody).toContain("# extracted-tree for");
    expect(manifestBody).toContain("# (find failed for");

    const statusBody = readFileSync(statusPath, "utf8").replaceAll(out, "<OUT>");
    expect(statusBody).toMatchInlineSnapshot(`
      "
      ### pretty-index-mismatch-ci preflight status — \`atomic\`

      | file | status | path |
      |---|---|---|
      | validate-report.json | MISSING | \`<OUT>/validate-report.json\` |
      | validate-schema-assertion.txt | MISSING | \`<OUT>/validate-schema-assertion.txt\` |

      _Non-OK entries above indicate the preflight would fail locally. Re-run \`make pretty-index-mismatch-ci-bundle-download RUN_ID=<id> PI_CI_SCOPE=atomic\` to reproduce._

      "
    `);
  });
});