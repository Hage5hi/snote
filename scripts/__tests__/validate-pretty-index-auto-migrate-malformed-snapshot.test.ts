// Snapshot: exact stderr from validate-pretty-index.py --auto-migrate for
// (a) a legacy v0 array of valid entries (migration summary + success)
// (b) a MALFORMED pretty-index.json — an unsupported schema_version
// envelope. Migration is skipped (envelope-level problem), no migration
// block is emitted, and the validator exits 3 with the unsupported-
// version regeneration hint. Locking this bytes-for-bytes catches
// accidental formatting drift in either code path.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const VALIDATOR = resolve(__dirname, "..", "validate-pretty-index.py");
const cleanups: string[] = [];
afterEach(() => {
  for (const d of cleanups.splice(0)) spawnSync("rm", ["-rf", d]);
});
function workdir() {
  const d = mkdtempSync(join(tmpdir(), "auto-migrate-malformed-"));
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
function norm(s: string, p: string) {
  return s.replaceAll(p, "<INDEX>").trimEnd();
}

describe("validate-pretty-index.py --auto-migrate stderr snapshots", () => {
  it("legacy v0 array: emits the migration block, then passes", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    writeFileSync(f, JSON.stringify([validEntry()]));
    const r = spawnSync(
      "python3",
      [VALIDATOR, "--auto-migrate", "--require-version", "1", f],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(norm(r.stderr, f)).toMatchInlineSnapshot(`
      "validate-pretty-index: auto-migrating <INDEX> (schema_version=0 -> 1)...
      == pretty-index migration ==
      from: v0 (legacy array)        entries: 1
      to:   v1 (envelope)            entries: 1
      file: <INDEX> (in-place)"
    `);
  });

  it("malformed (unsupported schema_version): no migration block, exit 3", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    writeFileSync(f, JSON.stringify({ schema_version: 99, entries: [] }));
    const r = spawnSync(
      "python3",
      [VALIDATOR, "--auto-migrate", "--require-version", "1", f],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(3);
    expect(r.stderr).not.toContain("== pretty-index migration ==");
    expect(r.stderr).not.toContain("auto-migrating");
    expect(norm(r.stderr, f)).toMatchInlineSnapshot(`
      "validate-pretty-index: schema validation failed for <INDEX> (1 problem(s)):
        - unsupported schema_version=99 (this validator supports [0, 1]; current=1) — regenerate pretty-index.json with scripts/pretty-replay-summary.py (or re-run the CI \\"append pretty replay-summary to step summary\\" step) to upgrade to schema_version=1; if the file is newer than this validator, update scripts/validate-pretty-index.py (see docs/schema-drift-diff-test-hooks.md)"
    `);
  });
});
