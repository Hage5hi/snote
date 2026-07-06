// E2E: an artifact with multiple `jq-parse-failed` per-file entries must
// carry a matching `stderr_excerpt` sidecar for EACH failing file, and the
// summary's `jq_stderr_path` for each row must resolve to a real file on
// disk. Guards the sidecar mapping documented in README.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const FETCH = resolve(REPO, "scripts/ci/pi-ci-fetch-and-reproduce.sh");
const has = (b: string) => { try { return spawnSync("sh", ["-c", `command -v ${b}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;

let work: string;
d("multi jq-parse-failed rows — each has a matching stderr sidecar", () => {
  beforeEach(() => { work = mkdtempSync(join(tmpdir(), "pi-ci-multi-jq-")); });
  afterEach(() => { rmSync(work, { recursive: true, force: true }); });

  it("fetch-and-reproduce succeeds and each row's jq_stderr_path resolves", () => {
    const artifactDir = join(work, "artifact");
    mkdirSync(artifactDir, { recursive: true });

    const rows = [
      { label: "extracted-tree.json", slug: "extracted-tree-json", excerpt: "parse error: line 1" },
      { label: "preflight-status.json", slug: "preflight-status-json", excerpt: "parse error: line 2" },
      { label: "run-manifest.json", slug: "run-manifest-json", excerpt: "parse error: line 3" },
    ];
    // Write inputs + sidecars for every failing row.
    for (const r of rows) {
      writeFileSync(join(artifactDir, r.label), "not-json");
      writeFileSync(join(artifactDir, `report-schema-jq-${r.slug}.stderr.txt`), r.excerpt);
    }

    const summary = {
      schema: "pi-ci/report-schema-validation-summary/v1",
      expected_schema_version: "1", out_dir: artifactDir,
      terminated_by: null, exit: 5,
      pi_ci_jq_bin: "", jq_bin: "jq", jq_version: "jq-1.7", jq_cmdline: "jq .", jq_timeout_secs: "10",
      files: rows.map(r => ({
        label: r.label,
        path: join(artifactDir, r.label),
        expected_schema_version: "1", actual_schema_version: "",
        status: "FAIL", exit: 5, reason: "jq-parse-failed",
        diff: null,
        jq_stderr_excerpt: r.excerpt,
        jq_stderr_path: join(artifactDir, `report-schema-jq-${r.slug}.stderr.txt`),
      })),
    };
    const summaryPath = join(artifactDir, "report-schema-validation-summary.json");
    writeFileSync(summaryPath, JSON.stringify(summary));

    // Shim gh to copy the artifact into the download dir.
    const shimDir = join(work, "bin");
    mkdirSync(shimDir, { recursive: true });
    const gh = join(shimDir, "gh");
    writeFileSync(gh, `#!/usr/bin/env bash
dir=""
while [ $# -gt 0 ]; do case "$1" in --dir) dir="$2"; shift 2 ;; *) shift ;; esac; done
mkdir -p "$dir"; cp -R "${artifactDir}"/. "$dir"/
`);
    spawnSync("chmod", ["+x", gh]);

    const dest = join(work, "dl");
    const r = spawnSync("bash", [FETCH, "42", "--dest", dest], {
      encoding: "utf8", env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
    });
    // Fetch step should succeed (all sidecars present) and hand off to
    // the repro printer, which exits 0.
    expect(r.status).toBe(0);

    // Every documented sidecar file was preserved through the download.
    for (const row of rows) {
      const side = join(dest, `report-schema-jq-${row.slug}.stderr.txt`);
      expect(existsSync(side)).toBe(true);
      expect(readFileSync(side, "utf8")).toBe(row.excerpt);
      // And the repro printer emitted the exact path + excerpt.
      expect(r.stdout).toContain(`stderr_path=    ${side}`);
      expect(r.stdout).toContain(`excerpt=        ${row.excerpt}`);
      expect(r.stdout).toContain(`label=          ${row.label}`);
    }
    // Sanity: sidecar basenames follow the documented slug pattern.
    for (const row of rows) {
      expect(basename(`report-schema-jq-${row.slug}.stderr.txt`))
        .toMatch(/^report-schema-jq-[a-z0-9-]+\.stderr\.txt$/);
    }
  }, 60_000);
});
