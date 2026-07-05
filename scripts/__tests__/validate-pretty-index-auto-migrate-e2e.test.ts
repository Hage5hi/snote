// E2E: validate-pretty-index.py --auto-migrate on a legacy v0 file.
//
// Success case: legacy v0 array of valid entries -> auto-migrates in place
// and the follow-up validation passes (exit 0). The before/after summary
// from migrate-pretty-index.py is forwarded on stderr.
//
// Failure case: legacy v0 array containing an entry that is missing
// required keys -> auto-migration succeeds (v0 -> v1 envelope) but the
// re-validation still fails per-entry (exit 3). This proves the job
// still fails when regeneration alone cannot fix the schema.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const VALIDATOR = join(REPO, "scripts", "validate-pretty-index.py");

const cleanups: string[] = [];
afterEach(() => {
  for (const d of cleanups.splice(0)) spawnSync("rm", ["-rf", d]);
});

function workdir() {
  const d = mkdtempSync(join(tmpdir(), "auto-migrate-e2e-"));
  cleanups.push(d);
  return d;
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

describe("validate-pretty-index.py --auto-migrate (e2e)", () => {
  it("migrates a valid v0 file in place, emits summary, then passes", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    writeFileSync(f, JSON.stringify([validEntry()]));

    const r = spawnSync(
      "python3",
      [VALIDATOR, "--auto-migrate", "--require-version", "1", f],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("auto-migrating");
    // before/after summary comes from migrate-pretty-index.py
    expect(r.stderr).toContain("== pretty-index migration ==");
    expect(r.stderr).toMatch(/from: v0 \(legacy array\)/);
    expect(r.stderr).toMatch(/to:\s+v1 \(envelope\)/);

    const migrated = JSON.parse(readFileSync(f, "utf8"));
    expect(migrated.schema_version).toBe(1);
  });

  it("still fails (exit 3) when regeneration cannot fix per-entry schema errors", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    // Valid v0 envelope shape, but the entry is missing required keys —
    // migration succeeds, per-entry validation fails.
    const broken = [{ folder: "only-folder-key" }];
    writeFileSync(f, JSON.stringify(broken));

    const r = spawnSync(
      "python3",
      [VALIDATOR, "--auto-migrate", "--require-version", "1", f],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(3);
    // The summary must still be emitted even though re-validation fails.
    expect(r.stderr).toContain("== pretty-index migration ==");
    expect(r.stderr).toMatch(/schema validation failed/);
    expect(r.stderr).toMatch(/missing key: summary_file/);

    // File was rewritten to a v1 envelope (migration itself worked).
    const migrated = JSON.parse(readFileSync(f, "utf8"));
    expect(migrated.schema_version).toBe(1);
    expect(Array.isArray(migrated.entries)).toBe(true);
  });
});
