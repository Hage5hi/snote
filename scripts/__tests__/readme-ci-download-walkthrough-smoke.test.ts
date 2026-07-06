// Fast CI smoke: replays the README's copy-paste artifact-download flow
// against a shim `gh` that serves a realistic artifact, then asserts that
// every sidecar the README documents lands on disk. On failure, the test
// emits an actionable message pointing at the README section that drifted.
//
// Kept intentionally lean (single artifact, single reason) so it runs in
// well under a second — the deep coverage lives in
// `readme-ci-download-walkthrough.test.ts`.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const README = resolve(REPO, "README.md");
const has = (b: string) => { try { return spawnSync("sh", ["-c", `command -v ${b}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

const REQUIRED_SIDECARS = [
  "report-schema-validation-summary.json",
  "report-schema-jq-extracted-tree-json.stderr.txt",
  "extracted-tree.json",
];

let work: string;
d("README CI-download smoke", () => {
  beforeEach(() => { work = mkdtempSync(join(tmpdir(), "pi-ci-readme-smoke-")); });
  afterEach(() => { rmSync(work, { recursive: true, force: true }); });

  it("downloads the documented artifact and lands every required sidecar", () => {
    const readme = readFileSync(README, "utf8");
    // Guard against README drift: the artifact name + repro script must still be documented.
    expect(readme).toContain("pretty-index-mismatch-ci-schema-validator-io-atomic-linux");
    expect(readme).toContain("scripts/ci/pi-ci-reproduce-jq-failure.sh");

    const artifactDir = join(work, "artifact");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, "report-schema-jq-extracted-tree-json.stderr.txt"), "jq: parse error");
    writeFileSync(join(artifactDir, "extracted-tree.json"), "not-json");
    writeFileSync(join(artifactDir, "report-schema-validation-summary.json"), JSON.stringify({
      schema: "pi-ci/report-schema-validation-summary/v1",
      expected_schema_version: "1", out_dir: artifactDir, terminated_by: null, exit: 5,
      pi_ci_jq_bin: "", jq_bin: "jq", jq_version: "jq-1.7", jq_cmdline: "jq .", jq_timeout_secs: "10",
      files: [{ label: "extracted-tree.json", path: join(artifactDir, "extracted-tree.json"),
        expected_schema_version: "1", actual_schema_version: "", status: "FAIL", exit: 5,
        reason: "jq-parse-failed", diff: null, jq_stderr_excerpt: "jq: parse error",
        jq_stderr_path: join(artifactDir, "report-schema-jq-extracted-tree-json.stderr.txt") }],
    }));

    // Shim `gh` — copies the artifact into the requested --dir.
    const shimDir = join(work, "bin");
    mkdirSync(shimDir, { recursive: true });
    const ghShim = join(shimDir, "gh");
    writeFileSync(ghShim, `#!/usr/bin/env bash
set -e
dir=""
while [ $# -gt 0 ]; do
  case "$1" in --dir) dir="$2"; shift 2 ;; *) shift ;;
  esac
done
mkdir -p "$dir"; cp -R "${artifactDir}"/. "$dir"/
`);
    chmodSync(ghShim, 0o755);

    const dest = join(work, "dl");
    const r = spawnSync("bash", ["-c",
      `gh run download 1 --name pretty-index-mismatch-ci-schema-validator-io-atomic-linux --dir "${dest}"`
    ], { encoding: "utf8", env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` } });
    expect(r.status).toBe(0);

    const missing = REQUIRED_SIDECARS.filter((f) => !existsSync(join(dest, f)));
    // Checksum + size parity: aggregate every mismatch so a single failing
    // run reports the full list — not just the first bad file.
    const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    const mismatches: Array<{ file: string; expectedSize: number; actualSize: number; expectedSha: string; actualSha: string }> = [];
    for (const f of REQUIRED_SIDECARS) {
      if (missing.includes(f)) continue;
      const src = join(artifactDir, f), dl = join(dest, f);
      const expectedSize = statSync(src).size, actualSize = statSync(dl).size;
      const expectedSha = sha(src), actualSha = sha(dl);
      if (expectedSize !== actualSize || expectedSha !== actualSha) {
        mismatches.push({ file: f, expectedSize, actualSize, expectedSha, actualSha });
      }
    }
    if (missing.length || mismatches.length) {
      const lines: string[] = ["README CI-download walkthrough drift:"];
      if (missing.length) {
        lines.push(`  missing ${missing.length} sidecar(s): ${missing.join(", ")}`);
      }
      for (const m of mismatches) {
        lines.push(
          `  mismatch '${m.file}': expected size=${m.expectedSize} sha256=${m.expectedSha}, ` +
          `got size=${m.actualSize} sha256=${m.actualSha}`,
        );
      }
      lines.push(
        `Update README's "Downloading CI failure artifacts" section or the artifact ` +
        `upload/download pipeline so every documented sidecar is present and byte-identical.`,
      );
      throw new Error(lines.join("\n"));
    }
    for (const f of REQUIRED_SIDECARS) expect(statSync(join(dest, f)).size).toBeGreaterThan(0);
  }, 30_000);
});
