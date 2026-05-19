// Integration tests: the summary-json the validator writes to disk
// MUST conform to a stable shape with a pinned schemaVersion + the
// required top-level fields, for BOTH the success path (validator
// exit 0) and the failure path (validator exit non-zero on schema /
// shape errors). Anyone consuming this file (PR bots, dashboards,
// the debug-bundle artifact) relies on these fields existing — these
// tests catch a silent rename or schema bump before it ships.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FAILURE_BREAKDOWN_SCHEMA_VERSION } from "../ci-vitest-failure-summary";

const SCRIPT = resolve(__dirname, "../ci-validate-breakdown-json.ts");
const SUMMARY_SCHEMA_VERSION = 1;
const SUMMARY_REQUIRED_KEYS = ["schemaVersion", "ok", "totals", "perKind"] as const;
const TOTALS_REQUIRED_KEYS = ["ok", "failed", "missing"] as const;

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ci-summary-schema-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const validPayload = () => ({
  schemaVersion: FAILURE_BREAKDOWN_SCHEMA_VERSION,
  failureCount: 0,
  suiteCount: 0,
  failures: [],
});

const runValidator = (args: string[]) => {
  let exitCode = 0;
  try {
    execSync(`bun run ${SCRIPT} ${args.join(" ")}`, {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (e: any) {
    exitCode = e.status ?? 1;
  }
  return exitCode;
};

const assertSummaryShape = (summary: unknown) => {
  expect(summary).toBeTypeOf("object");
  expect(summary).not.toBeNull();
  const s = summary as Record<string, unknown>;
  for (const key of SUMMARY_REQUIRED_KEYS) {
    expect(s, `missing top-level key ${key}`).toHaveProperty(key);
  }
  expect(s.schemaVersion).toBe(SUMMARY_SCHEMA_VERSION);
  expect(typeof s.ok).toBe("boolean");
  expect(s.totals).toBeTypeOf("object");
  const totals = s.totals as Record<string, unknown>;
  for (const key of TOTALS_REQUIRED_KEYS) {
    expect(totals, `missing totals.${key}`).toHaveProperty(key);
    expect(typeof totals[key]).toBe("number");
  }
  expect(s.perKind).toBeTypeOf("object");
  const perKind = s.perKind as Record<string, Record<string, unknown>>;
  for (const [kind, bucket] of Object.entries(perKind)) {
    for (const key of TOTALS_REQUIRED_KEYS) {
      expect(bucket, `perKind.${kind} missing ${key}`).toHaveProperty(key);
      expect(typeof bucket[key]).toBe("number");
    }
  }
};

describe("summary-json schema — success path", () => {
  it("exit 0 + summary file matches schemaVersion + required fields", () => {
    const f = join(dir, "failure-breakdown.json");
    writeFileSync(f, JSON.stringify(validPayload()));
    const summaryPath = join(dir, "summary-success.json");

    const exit = runValidator([f, "--summary-json", summaryPath]);
    expect(exit).toBe(0);

    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    assertSummaryShape(summary);
    expect(summary.ok).toBe(true);
    expect(summary.totals).toEqual({ ok: 1, failed: 0, missing: 0 });
    expect(summary.perKind.failure).toEqual({ ok: 1, failed: 0, missing: 0 });
  });
});

describe("summary-json schema — failure path", () => {
  it("exit non-zero on schema mismatch BUT summary file still has the same shape", () => {
    const bad = join(dir, "failure-breakdown.json");
    writeFileSync(bad, JSON.stringify({ schemaVersion: 999 }));
    const summaryPath = join(dir, "summary-failure.json");

    const exit = runValidator([bad, "--summary-json", summaryPath]);
    expect(exit).not.toBe(0);

    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    assertSummaryShape(summary);
    expect(summary.ok).toBe(false);
    expect(summary.totals.failed).toBeGreaterThan(0);
    expect(summary.perKind.failure.failed).toBeGreaterThan(0);
  });

  it("exit non-zero on missing file (no --allow-missing) — still writes a valid-shape summary", () => {
    const absent = join(dir, "parity-breakdown.json"); // never created
    const summaryPath = join(dir, "summary-missing.json");

    const exit = runValidator([absent, "--summary-json", summaryPath]);
    expect(exit).not.toBe(0);

    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    assertSummaryShape(summary);
    expect(summary.ok).toBe(false);
    expect(summary.perKind.parity.failed).toBeGreaterThan(0);
  });

  it("exit non-zero on malformed JSON — still writes a valid-shape summary", () => {
    const broken = join(dir, "flags-breakdown.json");
    writeFileSync(broken, "{not valid json");
    const summaryPath = join(dir, "summary-malformed.json");

    const exit = runValidator([broken, "--summary-json", summaryPath]);
    expect(exit).not.toBe(0);

    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    assertSummaryShape(summary);
    expect(summary.ok).toBe(false);
    expect(summary.perKind.flags.failed).toBeGreaterThan(0);
  });
});

describe("summary-json schema — mixed success + failure in one run", () => {
  it("rolls up totals while preserving per-kind ok/failed counts", () => {
    const good = join(dir, "failure-breakdown.json");
    const bad = join(dir, "parity-breakdown.json");
    writeFileSync(good, JSON.stringify(validPayload()));
    writeFileSync(bad, JSON.stringify({ schemaVersion: 999 }));
    const summaryPath = join(dir, "summary-mixed.json");

    const exit = runValidator([good, bad, "--summary-json", summaryPath]);
    expect(exit).not.toBe(0);

    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    assertSummaryShape(summary);
    expect(summary.ok).toBe(false);
    expect(summary.totals.ok).toBe(1);
    expect(summary.totals.failed).toBe(1);
    expect(summary.perKind.failure).toEqual({ ok: 1, failed: 0, missing: 0 });
    expect(summary.perKind.parity).toEqual({ ok: 0, failed: 1, missing: 0 });
  });
});
