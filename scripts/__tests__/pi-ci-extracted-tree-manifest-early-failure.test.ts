// E2E-style test for scripts/ci/pi-ci-extracted-tree-manifest.sh.
//
// Simulates the CI failure mode where tarball extraction crashed BEFORE
// any files (or even the output directory) landed on disk. Asserts that
// the manifest script still produces `<out>/extracted-tree.txt` so the
// downstream `actions/upload-artifact` step always finds a file at the
// expected path — the failure upload never becomes inconsistent between
// runs regardless of when the failure occurred.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, "scripts/ci/pi-ci-extracted-tree-manifest.sh");

const hasBash = (() => {
  try { return spawnSync("bash", ["--version"]).status === 0; }
  catch { return false; }
})();

let workdir: string;

const d = hasBash ? describe : describe.skip;

d("pi-ci-extracted-tree-manifest.sh — early-extraction-failure resilience", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-mf-"));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("creates the manifest file even when the output dir does not exist yet", () => {
    // Point at a NON-EXISTENT subdirectory — mimics the tarball-extraction
    // failure case where nothing has landed on disk yet.
    const out = join(workdir, "does-not-exist-yet");
    expect(existsSync(out)).toBe(false);

    const res = spawnSync("bash", [SCRIPT, out], { encoding: "utf8" });
    expect(res.status).toBe(0);

    const mf = join(out, "extracted-tree.txt");
    expect(existsSync(mf)).toBe(true); // MUST exist — upload consistency
    // Header lines should be present so the artifact is self-describing
    // even though the source directory was empty.
    const body = readFileSync(mf, "utf8");
    expect(body).toContain("# extracted-tree for");
    expect(body).toContain("# generated-at:");
  });

  it("still creates the manifest when the output dir exists but is empty", () => {
    const out = join(workdir, "empty");
    // Pre-create empty — mimics `mkdir -p` succeeding but extraction
    // producing zero files.
    require("node:fs").mkdirSync(out);
    const res = spawnSync("bash", [SCRIPT, out], { encoding: "utf8" });
    expect(res.status).toBe(0);
    const mf = join(out, "extracted-tree.txt");
    expect(existsSync(mf)).toBe(true);
    // File is created (non-negative size); may be empty listing but the
    // header block still lands.
    expect(statSync(mf).size).toBeGreaterThan(0);
  });
});
