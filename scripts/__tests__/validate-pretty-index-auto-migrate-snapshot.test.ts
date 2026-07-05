// Snapshot tests: assert the EXACT before/after migration summary that
// validate-pretty-index.py --auto-migrate forwards on stderr, for both
// the success path (re-validation passes) and the failure path
// (re-validation still fails because per-entry problems remain).
//
// The migrator writes a fixed-width three-line block:
//
//   == pretty-index migration ==
//   from: v0 (legacy array)     entries: N
//   to:   v1 (envelope)         entries: N
//   file: <path> (in-place)
//
// The validator prepends its own "auto-migrating <path> (schema_version=
// 0 -> 1)..." line. We snapshot just those bytes (path-normalized) so
// any accidental formatting change trips the test.
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
  const d = mkdtempSync(join(tmpdir(), "auto-migrate-snap-"));
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

/**
 * Extract just the deterministic auto-migrate summary block and
 * normalize the file path so snapshots are stable across tmpdirs.
 */
function extractSummary(stderr: string, indexPath: string): string {
  return stderr
    .split("\n")
    .filter((l) =>
      l.startsWith("validate-pretty-index: auto-migrating") ||
      l.startsWith("== pretty-index migration ==") ||
      l.startsWith("from:") ||
      l.startsWith("to:") ||
      l.startsWith("file:"),
    )
    .join("\n")
    .replaceAll(indexPath, "<INDEX>");
}

describe("validate-pretty-index.py --auto-migrate summary snapshots", () => {
  it("success path: exact before/after summary and passing re-validation", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    writeFileSync(f, JSON.stringify([validEntry()]));

    const r = spawnSync(
      "python3",
      [VALIDATOR, "--auto-migrate", "--require-version", "1", f],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(extractSummary(r.stderr, f)).toMatchInlineSnapshot(`
      "validate-pretty-index: auto-migrating <INDEX> (schema_version=0 -> 1)...
      == pretty-index migration ==
      from: v0 (legacy array)        entries: 1
      to:   v1 (envelope)            entries: 1
      file: <INDEX> (in-place)"
    `);
  });

  it("re-validation-fails path: same summary is emitted; exit 3", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    // Valid v0 envelope shape but the entry is missing required keys —
    // migration succeeds, per-entry validation fails afterwards.
    writeFileSync(f, JSON.stringify([{ folder: "only-folder-key" }]));

    const r = spawnSync(
      "python3",
      [VALIDATOR, "--auto-migrate", "--require-version", "1", f],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(3);
    expect(extractSummary(r.stderr, f)).toMatchInlineSnapshot(`
      "validate-pretty-index: auto-migrating <INDEX> (schema_version=0 -> 1)...
      == pretty-index migration ==
      from: v0 (legacy array)     entries: 1
      to:   v1 (envelope)         entries: 1
      file: <INDEX> (in-place)"
    `);
    // And the re-validation stderr still carries the per-entry failure.
    expect(r.stderr).toMatch(/schema validation failed/);
    expect(r.stderr).toMatch(/missing key: summary_file/);
  });
});
