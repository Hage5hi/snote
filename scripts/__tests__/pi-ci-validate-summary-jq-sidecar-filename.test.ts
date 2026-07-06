// E2E: jq-parse-failed rows point at the documented sidecar filename
// pattern `report-schema-jq-<slug>.stderr.txt`, the sidecar file exists
// on disk under the validator out-dir (the artifact upload glob picks
// it up), and its contents match the excerpt embedded in the summary.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("jq") ? describe : describe.skip;
const VALIDATE = join(REPO_ROOT, "scripts/ci/pi-ci-validate-report-schemas.sh");

const slugify = (label: string) => label.replace(/[^A-Za-z0-9]/g, "-");

let workdir: string;

d("summary — jq-parse-failed sidecar filenames match documented pattern", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-jq-sidecar-"));
    writeFileSync(join(workdir, "extracted-tree.json"), "{not json,,,");
    writeFileSync(join(workdir, "preflight-status.json"), "<<<invalid>>>");
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("each per-file entry's jq_stderr_path matches report-schema-jq-<slug>.stderr.txt and contains the excerpt", () => {
    const r = spawnSync("bash", [VALIDATE, workdir], {
      encoding: "utf8",
      env: { ...process.env, PI_CI_EXPECTED_SCHEMA_VERSION: "1" },
    });
    expect(r.status).not.toBe(0);
    const summary = JSON.parse(readFileSync(join(workdir, "report-schema-validation-summary.json"), "utf8"));
    for (const row of summary.files) {
      expect(row.reason).toBe("jq-parse-failed");
      expect(dirname(row.jq_stderr_path)).toBe(workdir);
      expect(basename(row.jq_stderr_path)).toBe(`report-schema-jq-${slugify(row.label)}.stderr.txt`);
      expect(existsSync(row.jq_stderr_path)).toBe(true);
      const contents = readFileSync(row.jq_stderr_path, "utf8");
      expect(contents.length).toBeGreaterThan(0);
      // First non-empty word of the excerpt should appear in the raw stderr.
      const firstWord = String(row.jq_stderr_excerpt).trim().split(/\s+/)[0];
      expect(contents).toContain(firstWord);
    }
  }, 20_000);
});
