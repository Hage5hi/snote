// Integration tests for the ci-validate-breakdown-json CLI — exercises
// the actual subprocess so we cover argv parsing, --kind inference vs.
// explicit override, mixed-kind file lists, exit codes, and the
// per-kind summary footer that CI logs / dashboards grep for.
//
// These tests spawn `bun run scripts/ci-validate-breakdown-json.ts`
// against temp files so the harness reflects exactly what CI runs.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FAILURE_BREAKDOWN_SCHEMA_VERSION } from "../ci-vitest-failure-summary";

const CLI = "scripts/ci-validate-breakdown-json.ts";

const goodPayload = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: FAILURE_BREAKDOWN_SCHEMA_VERSION,
    failureCount: 0,
    suiteCount: 0,
    failures: [],
    ...overrides,
  });

function runCli(args: string[]) {
  const res = spawnSync("bun", ["run", CLI, ...args], { encoding: "utf8" });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    combined: (res.stdout ?? "") + (res.stderr ?? ""),
  };
}

describe("ci-validate-breakdown-json CLI", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ci-validate-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("schemaVersion mismatch rejection", () => {
    it("rejects mismatch when kind is inferred from filename (--kind auto, default)", () => {
      const file = join(dir, "parity-breakdown.json");
      writeFileSync(file, goodPayload({ schemaVersion: 99 }));
      const r = runCli([file]); // default --kind auto
      expect(r.status).toBe(1);
      expect(r.combined).toMatch(/kind=parity/);
      expect(r.combined).toMatch(/schemaVersion mismatch: got 99, expected 1/);
    });

    it("rejects mismatch when kind is explicitly overridden via --kind flags", () => {
      // File NAME says "parity" but caller explicitly says treat it as flags.
      // Both share schemaVersion=1 today, so we use --schema-version to
      // force an expected version and confirm the override took effect.
      const file = join(dir, "parity-breakdown.json");
      writeFileSync(file, goodPayload({ schemaVersion: 1 }));
      const r = runCli([file, "--kind", "flags", "--schema-version", "42"]);
      expect(r.status).toBe(1);
      expect(r.combined).toMatch(/kind=flags/);
      expect(r.combined).toMatch(/schemaVersion mismatch: got 1, expected 42/);
    });

    it("accepts the matching schemaVersion across all three inferred kinds", () => {
      for (const kind of ["failure", "parity", "flags"] as const) {
        const file = join(dir, `${kind}-breakdown.json`);
        writeFileSync(file, goodPayload());
        const r = runCli([file]);
        expect(r.status).toBe(0);
        expect(r.combined).toMatch(new RegExp(`kind=${kind}.*shape OK`));
      }
    });
  });

  describe("mixed-kind validation in one run", () => {
    it("validates a mix of failure/parity/flags files and prints a per-kind summary", () => {
      const failureFile = join(dir, "failure-breakdown.json");
      const parityFile = join(dir, "parity-breakdown.json");
      const flagsFile = join(dir, "flags-breakdown.json");
      writeFileSync(failureFile, goodPayload());
      writeFileSync(parityFile, goodPayload({ schemaVersion: 999 })); // bad
      writeFileSync(flagsFile, goodPayload());
      const r = runCli([failureFile, parityFile, flagsFile]);
      expect(r.status).toBe(1); // one bad file → non-zero exit
      // Summary footer + per-kind counts.
      expect(r.stdout).toMatch(/--- ci-validate-breakdown-json summary ---/);
      expect(r.stdout).toMatch(/kind=failure ok=1 failed=0 missing=0/);
      expect(r.stdout).toMatch(/kind=parity ok=0 failed=1 missing=0/);
      expect(r.stdout).toMatch(/kind=flags ok=1 failed=0 missing=0/);
    });

    it("--allow-missing tallies missing files separately and still exits 0 when shape OK", () => {
      const parityFile = join(dir, "parity-breakdown.json");
      const flagsFile = join(dir, "flags-breakdown.json"); // never written
      writeFileSync(parityFile, goodPayload());
      const r = runCli([parityFile, flagsFile, "--allow-missing"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/kind=parity ok=1 failed=0 missing=0/);
      expect(r.stdout).toMatch(/kind=flags ok=0 failed=0 missing=1/);
  });

  describe("machine-parsable summary (SUMMARY_JSON + --summary-json)", () => {
    it("always prints a SUMMARY_JSON=<json> line on stdout with per-kind tallies", () => {
      const failureFile = join(dir, "failure-breakdown.json");
      const parityFile = join(dir, "parity-breakdown.json");
      writeFileSync(failureFile, goodPayload());
      writeFileSync(parityFile, goodPayload({ schemaVersion: 999 })); // bad
      const r = runCli([failureFile, parityFile]);
      expect(r.status).toBe(1);
      const match = r.stdout.match(/^SUMMARY_JSON=(.+)$/m);
      expect(match, `expected SUMMARY_JSON= line in stdout, got: ${r.stdout}`).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed).toMatchObject({
        schemaVersion: 1,
        ok: false,
        totals: { ok: 1, failed: 1, missing: 0 },
        perKind: {
          failure: { ok: 1, failed: 0, missing: 0 },
          parity: { ok: 0, failed: 1, missing: 0 },
        },
      });
    });

    it("writes the same payload to disk when --summary-json <path> is passed", () => {
      const failureFile = join(dir, "failure-breakdown.json");
      const summaryOut = join(dir, "nested", "validator-summary.json");
      writeFileSync(failureFile, goodPayload());
      const r = runCli([failureFile, "--summary-json", summaryOut]);
      expect(r.status).toBe(0);
      const onDisk = JSON.parse(
        (readFileSync as typeof readFileSync)(summaryOut, "utf8"),
      );
      expect(onDisk).toMatchObject({
        schemaVersion: 1,
        ok: true,
        totals: { ok: 1, failed: 0, missing: 0 },
        perKind: { failure: { ok: 1, failed: 0, missing: 0 } },
      });
      // And the stdout SUMMARY_JSON line matches the on-disk file.
      const stdoutPayload = JSON.parse(r.stdout.match(/^SUMMARY_JSON=(.+)$/m)![1]);
      expect(stdoutPayload).toEqual(onDisk);
    });
  });
});
