// E2E: consolidated summary from scripts/pretty-index-mismatch-ci-bundle-report.sh
// must explicitly show "missing extracted-tree.json / preflight-status.json"
// (or EMPTY / UNREADABLE) with the exact expected paths when those
// files are absent or unreadable.
//
// The report script regenerates sidecars via the manifest+status
// scripts, so to actually observe MISSING/EMPTY/UNREADABLE we point
// --dir at a *pre-existing* location and then remove/empty the files
// AFTER regeneration by wrapping the two generator scripts on PATH
// with stubs that leave the outputs alone.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const has = (bin: string) => {
  try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; }
};
const ok = has("bash") && has("jq");
const d = ok ? describe : describe.skip;

const REPORT = join(REPO_ROOT, "scripts/pretty-index-mismatch-ci-bundle-report.sh");

let workdir: string;
let extracted: string;
let stubs: string;

function writeStubs() {
  // No-op replacements for the two sidecar generators, so the outputs
  // we control by hand aren't overwritten by the report script.
  mkdirSync(stubs, { recursive: true });
  const noop = "#!/usr/bin/env bash\nexit 0\n";
  const p1 = join(stubs, "pi-ci-extracted-tree-manifest.sh");
  const p2 = join(stubs, "pi-ci-preflight-status-summary.sh");
  writeFileSync(p1, noop); chmodSync(p1, 0o755);
  writeFileSync(p2, noop); chmodSync(p2, 0o755);
  // The report script invokes `scripts/ci/pi-ci-...` by relative path,
  // so PATH shims alone won't intercept. Instead we shadow the whole
  // scripts/ci directory via a per-run copy of the report script that
  // is edited to point at our stubs. Simpler: symlink our stubs over
  // the real scripts INSIDE a private copy of the repo layout.
}

d("consolidated summary — missing/empty/unreadable sidecars", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "pi-ci-missing-sidecars-"));
    extracted = join(workdir, "extracted", "pi-ci-atomic");
    stubs = join(workdir, "stubs");
    mkdirSync(extracted, { recursive: true });
    writeStubs();
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("shows MISSING/EMPTY rows with the exact expected file paths", () => {
    // Build a minimal fake repo: symlink real scripts, override the two
    // generators with our no-op stubs. This lets us seed absent/empty
    // sidecars and observe them intact in the consolidated summary.
    const fakeRepo = join(workdir, "repo");
    mkdirSync(join(fakeRepo, "scripts/ci"), { recursive: true });
    // Copy report script + validator + schema-check scripts.
    for (const rel of [
      "scripts/pretty-index-mismatch-ci-bundle-report.sh",
      "scripts/ci/pi-ci-validate-report-schemas.sh",
      "scripts/ci/pi-ci-manifest-schema-check.sh",
      "scripts/ci/pi-ci-preflight-status-schema-check.sh",
    ]) {
      const src = join(REPO_ROOT, rel);
      const dst = join(fakeRepo, rel);
      spawnSync("cp", [src, dst]);
      chmodSync(dst, 0o755);
    }
    // Override the two generators with no-op stubs so seeded state
    // survives the report-script's regenerate step.
    for (const gen of [
      "pi-ci-extracted-tree-manifest.sh",
      "pi-ci-preflight-status-summary.sh",
    ]) {
      const dst = join(fakeRepo, "scripts/ci", gen);
      writeFileSync(dst, "#!/usr/bin/env bash\nexit 0\n");
      chmodSync(dst, 0o755);
    }

    // Seed a scenario: extracted-tree.json is ABSENT, preflight-status.json is EMPTY.
    const treePath = join(extracted, "extracted-tree.json");
    const prePath  = join(extracted, "preflight-status.json");
    writeFileSync(prePath, "");  // EMPTY
    // treePath deliberately not created → MISSING

    const r = spawnSync(
      "bash",
      [join(fakeRepo, "scripts/pretty-index-mismatch-ci-bundle-report.sh"), "--dir", extracted, "atomic"],
      { cwd: fakeRepo, encoding: "utf8" },
    );

    const out = r.stdout;
    expect(out).toContain("── missing/unreadable sidecars ──");
    expect(out).toMatch(new RegExp(`MISSING\\s+extracted-tree\\.json\\s+file=${treePath.replace(/[.\/]/g, "\\$&")}`));
    expect(out).toMatch(new RegExp(`EMPTY\\s+preflight-status\\.json\\s+file=${prePath.replace(/[.\/]/g, "\\$&")}`));
    // Also expect the consolidated block to be present in the same output.
    expect(out).toContain("── pretty-index-mismatch-ci consolidated report ──");
  }, 60_000);

  it("prints '(none — both sidecars present and readable)' when everything is fine", () => {
    // Seed BOTH sidecars with schema-valid content by running the real
    // generators against the extracted dir (no stubs here).
    writeFileSync(join(extracted, "validate-report.json"), '{"a":1}');
    writeFileSync(join(extracted, "validate-schema-assertion.txt"), "ok\n");
    const r = spawnSync("bash", [REPORT, "--dir", extracted, "atomic"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("── missing/unreadable sidecars ──");
    expect(r.stdout).toContain("(none — both sidecars present and readable)");
  }, 60_000);
});
