// Schema/format check for the extracted-tree.json manifest and
// content-hash stability across runs. Complements the file-existence
// coverage in pi-ci-reporting-walk-failure.test.ts.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const MANIFEST_SCRIPT = join(REPO_ROOT, "scripts/ci/pi-ci-extracted-tree-manifest.sh");
const SCHEMA_SCRIPT = join(REPO_ROOT, "scripts/ci/pi-ci-manifest-schema-check.sh");
const STATUS_SCRIPT = join(REPO_ROOT, "scripts/ci/pi-ci-preflight-status-summary.sh");

const hasBash = (() => { try { return spawnSync("bash", ["--version"]).status === 0; } catch { return false; } })();
const hasJq = (() => { try { return spawnSync("jq", ["--version"]).status === 0; } catch { return false; } })();
const d = hasBash && hasJq ? describe : describe.skip;

let workdir: string;

function runManifest(out: string) {
  return spawnSync("bash", [MANIFEST_SCRIPT, out], { encoding: "utf8" });
}
function runSchema(f: string) {
  return spawnSync("bash", [SCHEMA_SCRIPT, f], { encoding: "utf8" });
}

d("pretty-index-mismatch-ci extracted-tree manifest — schema + walk failures", () => {
  beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "pi-ci-manifest-schema-")); });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("emits schema-valid JSON with content_hash on a happy-path directory", () => {
    const out = join(workdir, "pi-ci-atomic");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "validate-report.json"), '{"a":1}');
    writeFileSync(join(out, "validate-schema-assertion.txt"), "ok\n");

    expect(runManifest(out).status).toBe(0);
    const check = runSchema(join(out, "extracted-tree.json"));
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("OK:");

    const m = JSON.parse(readFileSync(join(out, "extracted-tree.json"), "utf8"));
    expect(m.schema).toBe("pi-ci/extracted-tree/v1");
    expect(m.walk_ok).toBe(true);
    expect(m.content_hash).toMatch(/^[A-Za-z0-9_-]+:.+/);
    expect(Array.isArray(m.entries)).toBe(true);
  });

  it("content_hash is stable across runs with identical inputs", () => {
    const out = join(workdir, "pi-ci-atomic");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "validate-report.json"), '{"a":1}');
    runManifest(out);
    const h1 = JSON.parse(readFileSync(join(out, "extracted-tree.json"), "utf8")).content_hash;
    runManifest(out);
    const h2 = JSON.parse(readFileSync(join(out, "extracted-tree.json"), "utf8")).content_hash;
    expect(h1).toBe(h2);
  });

  it("content_hash changes when the input files change", () => {
    const out = join(workdir, "pi-ci-atomic");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "validate-report.json"), "one");
    runManifest(out);
    const h1 = JSON.parse(readFileSync(join(out, "extracted-tree.json"), "utf8")).content_hash;
    writeFileSync(join(out, "validate-report.json"), "one-plus-more");
    runManifest(out);
    const h2 = JSON.parse(readFileSync(join(out, "extracted-tree.json"), "utf8")).content_hash;
    expect(h1).not.toBe(h2);
  });

  it("still writes a schema-valid manifest for an empty directory (walk_ok=true, entries=[])", () => {
    const out = join(workdir, "pi-ci-empty");
    mkdirSync(out, { recursive: true });
    expect(runManifest(out).status).toBe(0);
    expect(runSchema(join(out, "extracted-tree.json")).status).toBe(0);
    const m = JSON.parse(readFileSync(join(out, "extracted-tree.json"), "utf8"));
    expect(m.walk_ok).toBe(true);
    expect(m.entries).toEqual([]);
  });

  it("still writes a schema-valid manifest when the directory does not exist (walk_ok=false)", () => {
    const out = join(workdir, "does-not-exist");
    expect(runManifest(out).status).toBe(0);
    expect(runSchema(join(out, "extracted-tree.json")).status).toBe(0);
    const m = JSON.parse(readFileSync(join(out, "extracted-tree.json"), "utf8"));
    expect(m.walk_ok).toBe(false);
    expect(m.entries).toEqual([]);
  });

  it("permission-denied on a subdirectory still leaves a schema-valid manifest", () => {
    const out = join(workdir, "pi-ci-perm");
    const sub = join(out, "locked");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(out, "validate-report.json"), '{"a":1}');
    writeFileSync(join(sub, "secret"), "x");
    chmodSync(sub, 0o000);
    try {
      expect(runManifest(out).status).toBe(0);
      expect(runSchema(join(out, "extracted-tree.json")).status).toBe(0);
      const m = JSON.parse(readFileSync(join(out, "extracted-tree.json"), "utf8"));
      // Whatever find could see must be a valid entry list. Manifest exists
      // regardless of the walk's partial failure — that's the guarantee.
      expect(Array.isArray(m.entries)).toBe(true);
    } finally {
      chmodSync(sub, 0o700);
    }
  });

  it("preflight status summary stays consistent when manifest input file is corrupted (non-JSON)", () => {
    const out = join(workdir, "pi-ci-corrupt");
    mkdirSync(out, { recursive: true });
    // "corrupt" validate-report.json → still counted as OK by preflight (non-empty),
    // schema-of-report is a downstream concern; the reporting layer must not crash.
    writeFileSync(join(out, "validate-report.json"), "not-json-at-all{{{");
    writeFileSync(join(out, "validate-schema-assertion.txt"), "assert\n");

    const status = spawnSync("bash", [STATUS_SCRIPT, out, "atomic"], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: "/dev/null" },
    });
    expect(status.status).toBe(0);
    const j = JSON.parse(readFileSync(join(out, "preflight-status.json"), "utf8"));
    expect(j.schema).toBe("pi-ci/preflight-status/v1");
    expect(j.validate_report.status).toBe("OK");
    expect(j.content_hash).toMatch(/^[A-Za-z0-9_-]+:.+/);

    expect(runManifest(out).status).toBe(0);
    expect(runSchema(join(out, "extracted-tree.json")).status).toBe(0);
  });

  it("rejects a manifest that is missing required keys", () => {
    const bad = join(workdir, "bad.json");
    writeFileSync(bad, JSON.stringify({ schema: "wrong", entries: "nope" }));
    const r = runSchema(bad);
    expect(r.status).toBe(5);
    expect(r.stderr).toContain("failed schema check");
  });
});
