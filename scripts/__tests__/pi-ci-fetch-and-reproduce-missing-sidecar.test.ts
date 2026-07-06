// E2E: pi-ci-fetch-and-reproduce.sh must fail with a clear error + specific
// exit code when the summary references a sidecar that isn't in the artifact.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const FETCH = resolve(REPO, "scripts/ci/pi-ci-fetch-and-reproduce.sh");
const has = (b: string) => { try { return spawnSync("sh", ["-c", `command -v ${b}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

let work: string;
d("pi-ci-fetch-and-reproduce.sh — missing sidecar", () => {
  beforeEach(() => { work = mkdtempSync(join(tmpdir(), "pi-ci-fetch-miss-")); });
  afterEach(() => { rmSync(work, { recursive: true, force: true }); });

  it("exits non-zero with a specific error naming the missing sidecar", () => {
    const artifactDir = join(work, "artifact");
    mkdirSync(artifactDir, { recursive: true });
    const missingSidecar = join(artifactDir, "report-schema-jq-extracted-tree-json.stderr.txt");
    // Deliberately do NOT write missingSidecar.
    const summary = {
      schema: "pi-ci/report-schema-validation-summary/v1",
      expected_schema_version: "1", out_dir: artifactDir,
      terminated_by: null, exit: 5,
      pi_ci_jq_bin: "", jq_bin: "jq", jq_version: "jq-1.7", jq_cmdline: "jq .", jq_timeout_secs: "10",
      files: [{
        label: "extracted-tree.json",
        path: join(artifactDir, "extracted-tree.json"),
        expected_schema_version: "1", actual_schema_version: "",
        status: "FAIL", exit: 5, reason: "jq-parse-failed",
        diff: null, jq_stderr_excerpt: "x",
        jq_stderr_path: missingSidecar,
      }],
    };
    writeFileSync(join(artifactDir, "report-schema-validation-summary.json"), JSON.stringify(summary));
    writeFileSync(join(artifactDir, "extracted-tree.json"), "x");

    // Shim gh to "download" the artifact (which is missing the sidecar).
    const shimDir = join(work, "bin");
    mkdirSync(shimDir, { recursive: true });
    const ghShim = join(shimDir, "gh");
    writeFileSync(ghShim, `#!/usr/bin/env bash
set -e
dir=""
while [ $# -gt 0 ]; do
  case "$1" in --dir) dir="$2"; shift 2 ;; --name) shift 2 ;; --repo) shift 2 ;; *) shift ;;
  esac
done
mkdir -p "$dir"
cp -R "${artifactDir}"/. "$dir"/
`);
    chmodSync(ghShim, 0o755);

    const r = spawnSync("bash", [FETCH, "42", "--dest", join(work, "dl")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
    });
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/summary references sidecars that are missing/);
    expect(r.stderr).toContain("report-schema-jq-extracted-tree-json.stderr.txt");
  }, 60_000);
});
