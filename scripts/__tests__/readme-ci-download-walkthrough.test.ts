// E2E: run the exact copy-paste commands from the README's "Downloading
// CI failure artifacts & reproducing locally" section against a shimmed
// `gh` and confirm every sidecar the README claims will be present
// actually lands on disk. Guards the README against drift with the
// script + sidecar naming contract.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const README = resolve(REPO, "README.md");
const has = (b: string) => { try { return spawnSync("sh", ["-c", `command -v ${b}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

let work: string;
d("README CI-download walkthrough", () => {
  beforeEach(() => { work = mkdtempSync(join(tmpdir(), "pi-ci-readme-dl-")); });
  afterEach(() => { rmSync(work, { recursive: true, force: true }); });

  it("mirrors the documented sidecar layout when the copy-paste commands run", () => {
    // Sanity: README still contains the exact artifact name + download line.
    const readme = readFileSync(README, "utf8");
    expect(readme).toContain("pretty-index-mismatch-ci-schema-validator-io-atomic-linux");
    expect(readme).toContain("gh run download <run-id>");
    expect(readme).toContain("scripts/ci/pi-ci-reproduce-jq-failure.sh");

    // Build the "server-side" artifact that CI would upload. Paths inside
    // the summary reference the *downloaded* location (`dest`) — the CI job
    // records exactly what a re-runner will see on disk after `gh run
    // download`, which is what the README repro line consumes.
    const dest = join(work, "pi-ci-repro");
    const artifactDir = join(work, "artifact");
    mkdirSync(artifactDir, { recursive: true });
    const sidecarBase = "report-schema-jq-extracted-tree-json.stderr.txt";
    writeFileSync(join(artifactDir, sidecarBase), "jq: parse error at line 1");
    writeFileSync(join(artifactDir, "extracted-tree.json"), "not-json");
    const summary = {
      schema: "pi-ci/report-schema-validation-summary/v1",
      expected_schema_version: "1", out_dir: dest,
      terminated_by: null, exit: 5,
      pi_ci_jq_bin: "", jq_bin: "jq", jq_version: "jq-1.7", jq_cmdline: "jq .", jq_timeout_secs: "10",
      files: [{
        label: "extracted-tree.json",
        path: join(dest, "extracted-tree.json"),
        expected_schema_version: "1", actual_schema_version: "",
        status: "FAIL", exit: 5, reason: "jq-parse-failed",
        diff: null, jq_stderr_excerpt: "jq: parse error at line 1",
        jq_stderr_path: join(dest, sidecarBase),
      }],
    };
    writeFileSync(
      join(artifactDir, "report-schema-validation-summary.json"),
      JSON.stringify(summary),
    );

    // Shim `gh` that honours the README's exact flag surface
    // (`gh run download <id> --name <artifact> --dir <dir>`).
    const shimDir = join(work, "bin");
    mkdirSync(shimDir, { recursive: true });
    const ghShim = join(shimDir, "gh");
    writeFileSync(ghShim, `#!/usr/bin/env bash
set -e
sub="$1"; shift
[ "$sub" = "run" ] || { echo "unexpected gh subcommand: $sub" >&2; exit 2; }
[ "$1" = "download" ] || { echo "unexpected gh run action: $1" >&2; exit 2; }
shift; shift    # discard "download" + <run-id>
name=""; dir=""
while [ $# -gt 0 ]; do
  case "$1" in --name) name="$2"; shift 2 ;; --dir) dir="$2"; shift 2 ;; *) shift ;; esac
done
[ "$name" = "pretty-index-mismatch-ci-schema-validator-io-atomic-linux" ] \
  || { echo "unexpected artifact name: $name" >&2; exit 1; }
mkdir -p "$dir"; cp -R "${artifactDir}"/. "$dir"/
`);
    chmodSync(ghShim, 0o755);

    // Run the exact README download line.
    const dl = spawnSync("bash", ["-c",
      `gh run download 999 --name pretty-index-mismatch-ci-schema-validator-io-atomic-linux --dir "${dest}"`
    ], { encoding: "utf8", env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` } });
    expect(dl.status).toBe(0);

    // Every documented file is on disk.
    expect(existsSync(join(dest, "report-schema-validation-summary.json"))).toBe(true);
    expect(existsSync(join(dest, sidecarBase))).toBe(true);
    expect(existsSync(join(dest, "extracted-tree.json"))).toBe(true);

    // The follow-up repro command from the README exits 0 and echoes the
    // input path we downloaded.
    const repro = spawnSync("bash", ["-c",
      `scripts/ci/pi-ci-reproduce-jq-failure.sh "${join(dest, "report-schema-validation-summary.json")}" ` +
      `--input "${join(dest, "extracted-tree.json")}" --jq-timeout-secs 10`
    ], { encoding: "utf8", cwd: REPO });
    expect(repro.status).toBe(0);
    expect(repro.stdout).toContain(`input_path=     ${join(dest, "extracted-tree.json")}`);
    expect(repro.stdout).toContain("reason=         jq-parse-failed");
  }, 60_000);
});
