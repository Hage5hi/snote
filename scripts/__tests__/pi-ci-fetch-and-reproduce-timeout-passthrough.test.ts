// E2E: pi-ci-fetch-and-reproduce.sh must forward jq_timeout_secs from the
// summary into pi-ci-reproduce-jq-failure.sh (via --jq-timeout-secs) for
// jq-parse-failed rows. We shim both `gh` and the repro script on PATH so
// no network / real gh CLI is required.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const FETCH = resolve(REPO, "scripts/ci/pi-ci-fetch-and-reproduce.sh");
const has = (b: string) => { try { return spawnSync("sh", ["-c", `command -v ${b}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

let work: string;
d("pi-ci-fetch-and-reproduce.sh — timeout pass-through", () => {
  beforeEach(() => { work = mkdtempSync(join(tmpdir(), "pi-ci-fetch-timeout-")); });
  afterEach(() => { rmSync(work, { recursive: true, force: true }); });

  it("passes jq_timeout_secs from summary into repro script for jq-parse-failed", () => {
    // Build a fake artifact tree the shim `gh` will "download" into --dir.
    const artifactDir = join(work, "artifact");
    mkdirSync(artifactDir, { recursive: true });
    const summary = {
      schema: "pi-ci/report-schema-validation-summary/v1",
      expected_schema_version: "1",
      out_dir: artifactDir,
      terminated_by: null, exit: 5,
      pi_ci_jq_bin: "", jq_bin: "jq", jq_version: "jq-1.7",
      jq_cmdline: "jq -r .schema_version",
      jq_timeout_secs: "17",
      files: [{
        label: "extracted-tree.json",
        path: join(artifactDir, "extracted-tree.json"),
        expected_schema_version: "1", actual_schema_version: "",
        status: "FAIL", exit: 5, reason: "jq-parse-failed",
        diff: null,
        jq_stderr_excerpt: "parse error",
        jq_stderr_path: join(artifactDir, "report-schema-jq-extracted-tree-json.stderr.txt"),
      }],
    };
    writeFileSync(join(artifactDir, "report-schema-validation-summary.json"), JSON.stringify(summary));
    writeFileSync(join(artifactDir, "extracted-tree.json"), "not json");
    writeFileSync(join(artifactDir, "report-schema-jq-extracted-tree-json.stderr.txt"), "parse error at line 1");

    // Shim `gh`: recognise `run download <id> --dir <D> --name <N>` and copy the tree.
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
[ -n "$dir" ] || exit 1
mkdir -p "$dir"
cp -R "${artifactDir}"/. "$dir"/
`);
    chmodSync(ghShim, 0o755);

    // Shim the repro script — record its argv so we can assert timeout was forwarded.
    const reproLog = join(work, "repro-argv.txt");
    const reproShim = resolve(REPO, "scripts/ci/pi-ci-reproduce-jq-failure.sh");
    const reproBak = join(work, "repro.bak");
    // Back up + replace
    writeFileSync(reproBak, readFileSync(reproShim, "utf8"));
    writeFileSync(reproShim, `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${reproLog}"
exit 0
`);
    chmodSync(reproShim, 0o755);

    try {
      const r = spawnSync("bash", [FETCH, "999", "--dest", join(work, "dl")], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
      });
      expect(r.status).toBe(0);
      const argv = readFileSync(reproLog, "utf8");
      expect(argv).toMatch(/--jq-timeout-secs\s*\n\s*17\s*\n/);
      // And the summary path is passed as positional
      expect(argv).toMatch(/report-schema-validation-summary\.json/);
    } finally {
      writeFileSync(reproShim, readFileSync(reproBak, "utf8"));
      chmodSync(reproShim, 0o755);
    }
  }, 60_000);
});
