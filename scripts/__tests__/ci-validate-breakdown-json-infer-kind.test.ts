// Pins kind-inference for every supported filename pattern, plus the
// mixed-order multi-file case that feeds --summary-json. If anyone
// adds/changes a naming convention (e.g. a future "snapshot-breakdown"
// kind), these tests fail loudly before the validator silently
// tags it as "unknown" and uses the wrong expected schemaVersion.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  EXPECTED_SCHEMA_VERSIONS,
  inferKind,
  type BreakdownKind,
} from "../ci-validate-breakdown-json";
import { FAILURE_BREAKDOWN_SCHEMA_VERSION } from "../ci-vitest-failure-summary";

const SCRIPT = resolve(__dirname, "../ci-validate-breakdown-json.ts");

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ci-infer-kind-"));
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

describe("inferKind — filename patterns", () => {
  const cases: Array<[string, BreakdownKind | "unknown"]> = [
    // failure
    ["failure-breakdown.json", "failure"],
    ["reports/_ci/failure-breakdown.json", "failure"],
    ["FAILURE-BREAKDOWN.json", "failure"],
    ["my-failure-breakdown-ubuntu.json", "failure"],
    // parity
    ["parity-breakdown.json", "parity"],
    ["reports/_ci/parity-breakdown.json", "parity"],
    ["PARITY-BREAKDOWN.json", "parity"],
    ["i18n-parity-breakdown-macos.json", "parity"],
    // flags
    ["flags-breakdown.json", "flags"],
    ["reports/_ci/flags-breakdown.json", "flags"],
    ["FLAGS-BREAKDOWN.json", "flags"],
    ["cli-flags-breakdown-windows.json", "flags"],
    // unknown
    ["random.json", "unknown"],
    ["breakdown.json", "unknown"],
    ["summary.json", "unknown"],
  ];

  it.each(cases)("inferKind(%j) → %s", (file, expected) => {
    expect(inferKind(file)).toBe(expected);
  });

  it("EXPECTED_SCHEMA_VERSIONS covers every BreakdownKind", () => {
    expect(Object.keys(EXPECTED_SCHEMA_VERSIONS).sort()).toEqual([
      "failure",
      "flags",
      "parity",
    ]);
  });
});

describe("ci-validate-breakdown-json CLI — mixed-order multi-file --summary-json", () => {
  it("per-kind counts are correct regardless of CLI argument order", () => {
    // Write one of each kind under several name patterns; pass them
    // in a deliberately scrambled order.
    const flags = join(dir, "flags-breakdown.json");
    const parity = join(dir, "cli-parity-breakdown-macos.json");
    const failure = join(dir, "FAILURE-BREAKDOWN.json");
    for (const f of [flags, parity, failure]) {
      writeFileSync(f, JSON.stringify(validPayload()));
    }
    const summaryPath = join(dir, "validate-summary-mixed.json");

    execSync(
      `bun run ${SCRIPT} ${flags} ${parity} ${failure} --summary-json ${summaryPath}`,
      { encoding: "utf8" },
    );

    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    expect(summary.ok).toBe(true);
    expect(summary.totals).toEqual({ ok: 3, failed: 0, missing: 0 });
    expect(summary.perKind).toEqual({
      failure: { ok: 1, failed: 0, missing: 0 },
      parity: { ok: 1, failed: 0, missing: 0 },
      flags: { ok: 1, failed: 0, missing: 0 },
    });
  });

  it("multiple files of the SAME kind accumulate under one per-kind bucket", () => {
    const a = join(dir, "parity-breakdown.json");
    const b = join(dir, "i18n-parity-breakdown-ubuntu.json");
    const c = join(dir, "cli-parity-breakdown-windows.json");
    for (const f of [a, b, c]) writeFileSync(f, JSON.stringify(validPayload()));
    const summaryPath = join(dir, "validate-summary-parity-only.json");

    execSync(
      `bun run ${SCRIPT} ${a} ${b} ${c} --summary-json ${summaryPath}`,
      { encoding: "utf8" },
    );

    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    expect(summary.perKind).toEqual({
      parity: { ok: 3, failed: 0, missing: 0 },
    });
    expect(summary.totals.ok).toBe(3);
  });

  it("an unknown-name file lands under the 'unknown' per-kind bucket but still validates against the default schema", () => {
    const known = join(dir, "failure-breakdown.json");
    const unknown = join(dir, "random.json");
    writeFileSync(known, JSON.stringify(validPayload()));
    writeFileSync(unknown, JSON.stringify(validPayload()));
    const summaryPath = join(dir, "validate-summary-with-unknown.json");

    execSync(
      `bun run ${SCRIPT} ${known} ${unknown} --summary-json ${summaryPath}`,
      { encoding: "utf8" },
    );

    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    expect(summary.ok).toBe(true);
    expect(summary.perKind.failure).toEqual({ ok: 1, failed: 0, missing: 0 });
    expect(summary.perKind.unknown).toEqual({ ok: 1, failed: 0, missing: 0 });
  });
});
