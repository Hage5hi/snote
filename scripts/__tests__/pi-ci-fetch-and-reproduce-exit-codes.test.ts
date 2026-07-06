// Unit-ish E2E covering pi-ci-fetch-and-reproduce.sh's documented exit
// codes for the three artifact-side failure modes:
//   3 → no matching artifact
//   4 → summary missing/empty
//   5 → summary references a sidecar the artifact doesn't contain
// (exit 5 already has a dedicated missing-sidecar spec; here we assert
// the exit-code + stderr contract for 3 and 4, and re-confirm 5 in one
// place so a future refactor can't regress the table in README.)
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

function writeGhShim(mode: "fail" | "empty-summary" | "with-missing-sidecar", opts?: { artifactDir?: string }): string {
  const shimDir = join(work, "bin");
  mkdirSync(shimDir, { recursive: true });
  const gh = join(shimDir, "gh");
  let body = "";
  if (mode === "fail") {
    body = `#!/usr/bin/env bash
echo "no artifact matches that name" >&2
exit 1
`;
  } else if (mode === "empty-summary") {
    // "Download" succeeds but the artifact contains no summary file at all.
    body = `#!/usr/bin/env bash
dir=""
while [ $# -gt 0 ]; do
  case "$1" in --dir) dir="$2"; shift 2 ;; *) shift ;; esac
done
mkdir -p "$dir"
: > "$dir/some-other-file.txt"
`;
  } else {
    body = `#!/usr/bin/env bash
dir=""
while [ $# -gt 0 ]; do
  case "$1" in --dir) dir="$2"; shift 2 ;; *) shift ;; esac
done
mkdir -p "$dir"
cp -R "${opts?.artifactDir}"/. "$dir"/
`;
  }
  writeFileSync(gh, body);
  chmodSync(gh, 0o755);
  return shimDir;
}

d("pi-ci-fetch-and-reproduce.sh — documented exit codes", () => {
  beforeEach(() => { work = mkdtempSync(join(tmpdir(), "pi-ci-fetch-exit-")); });
  afterEach(() => { rmSync(work, { recursive: true, force: true }); });

  it("exits 3 with a 'no matching CI failure artifact' message when gh finds nothing", () => {
    const shim = writeGhShim("fail");
    const r = spawnSync("bash", [FETCH, "1", "--dest", join(work, "dl")], {
      encoding: "utf8", env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
    });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/no matching CI failure artifact found for run 1/);
    expect(r.stderr).toMatch(/tried:/);
  }, 60_000);

  it("exits 4 with a 'summary … not found (or empty)' message when the artifact has no summary", () => {
    const shim = writeGhShim("empty-summary");
    const r = spawnSync("bash", [FETCH, "2", "--dest", join(work, "dl")], {
      encoding: "utf8", env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
    });
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/report-schema-validation-summary\.json not found \(or empty\)/);
    expect(r.stderr).toMatch(/artifact .* appears incomplete/);
  }, 60_000);

  it("exits 5 with a 'summary references sidecars that are missing' message", () => {
    const artifactDir = join(work, "artifact");
    mkdirSync(artifactDir, { recursive: true });
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
        jq_stderr_path: join(artifactDir, "report-schema-jq-extracted-tree-json.stderr.txt"),
      }],
    };
    writeFileSync(join(artifactDir, "report-schema-validation-summary.json"), JSON.stringify(summary));
    writeFileSync(join(artifactDir, "extracted-tree.json"), "x");
    // Intentionally: no sidecar file written.
    const shim = writeGhShim("with-missing-sidecar", { artifactDir });
    const r = spawnSync("bash", [FETCH, "3", "--dest", join(work, "dl")], {
      encoding: "utf8", env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
    });
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/summary references sidecars that are missing/);
    expect(r.stderr).toContain("report-schema-jq-extracted-tree-json.stderr.txt");
  }, 60_000);
});
