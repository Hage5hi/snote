// Contract: the regeneration hint text
//   "regenerate with `scripts/migrate-pretty-index.py <path> --in-place`"
//   "(or re-run this validator with --auto-migrate)"
// MUST be emitted on stderr ONLY when --require-version is provided AND
// the file's schema_version does not match. It MUST NOT appear for:
//   * a passing run (require-version matches),
//   * a per-entry schema failure at the correct version,
//   * a run without --require-version at all,
//   * a run with --auto-migrate that successfully re-validates
//     (the hint is replaced by the migration summary + auto-migrating line).
//
// CI forwards this stderr verbatim into $GITHUB_STEP_SUMMARY via
// `printf '%s\n' "$val_err"`, so asserting the stderr contract also
// pins the step-summary contract.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const VALIDATOR = resolve(__dirname, "..", "validate-pretty-index.py");
const HINT = /regenerate with `scripts\/migrate-pretty-index\.py .* --in-place`/;
const HINT_AUTO = /or re-run this validator with --auto-migrate/;

const cleanups: string[] = [];
afterEach(() => {
  for (const d of cleanups.splice(0)) spawnSync("rm", ["-rf", d]);
});
function workdir() {
  const d = mkdtempSync(join(tmpdir(), "regen-hint-"));
  cleanups.push(d);
  return d;
}
function write(body: string) {
  const d = workdir();
  const f = join(d, "pretty-index.json");
  writeFileSync(f, body);
  return f;
}
function run(...args: string[]) {
  return spawnSync("python3", [VALIDATOR, ...args], { encoding: "utf8" });
}
function validEntry() {
  return {
    folder: "20260705T134402Z-seed-42",
    summary_file: "artifacts/x/replay-summary.json",
    pretty_txt: "artifacts/x/pretty.txt",
    pretty_md: "artifacts/x/pretty.md",
    fail_reason: "",
    exit_code: 0,
    pretty_status: "ok",
    pretty_exit_code: 0,
  };
}

describe("regeneration hint emission contract", () => {
  it("EMITS the hint when --require-version fails on a v0 file", () => {
    const r = run("--require-version", "1", write("[]"));
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(HINT);
    expect(r.stderr).toMatch(HINT_AUTO);
  });

  it("does NOT emit the hint on a passing run", () => {
    const f = write(JSON.stringify({ schema_version: 1, entries: [] }));
    const r = run("--require-version", "1", f);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(HINT);
    expect(r.stderr).not.toMatch(HINT_AUTO);
  });

  it("does NOT emit the hint for per-entry failures at the required version", () => {
    const f = write(
      JSON.stringify({ schema_version: 1, entries: [{ folder: "only" }] }),
    );
    const r = run("--require-version", "1", f);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/missing key: summary_file/);
    expect(r.stderr).not.toMatch(HINT);
    expect(r.stderr).not.toMatch(HINT_AUTO);
  });

  it("does NOT emit the hint when --require-version is not provided", () => {
    const r = run(write("[]"));
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(HINT);
  });

  it("does NOT emit the hint when --auto-migrate succeeds", () => {
    const f = write(JSON.stringify([validEntry()]));
    const r = run("--auto-migrate", "--require-version", "1", f);
    expect(r.status).toBe(0);
    // Auto-migrate replaces the hint with the migration summary block.
    expect(r.stderr).not.toMatch(HINT);
    expect(r.stderr).toContain("== pretty-index migration ==");
  });
});
