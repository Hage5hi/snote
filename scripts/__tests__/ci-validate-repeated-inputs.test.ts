// Verifies how ci-validate-breakdown-json handles REPEATED inputs of
// the same kind: it aggregates per invocation (does NOT silently
// dedupe) so the per-kind counts in summary-json accurately reflect
// what the workflow asked it to validate. Pins the contract so a
// future "dedupe by path" change is intentional + accompanied by an
// update here.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FAILURE_BREAKDOWN_SCHEMA_VERSION } from "../ci-vitest-failure-summary";

const SCRIPT = resolve(__dirname, "../ci-validate-breakdown-json.ts");

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ci-repeat-"));
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

const badPayload = () => ({
  schemaVersion: 999,
  // missing required keys on purpose
});

describe("ci-validate-breakdown-json — repeated inputs of the same kind", () => {
  it("the SAME file passed twice aggregates as ok=2 under one per-kind bucket", () => {
    const f = join(dir, "failure-breakdown.json");
    writeFileSync(f, JSON.stringify(validPayload()));
    const summaryJson = join(dir, "summary-same-file-twice.json");

    execSync(
      `bun run ${SCRIPT} ${f} ${f} --summary-json ${summaryJson}`,
      { encoding: "utf8" },
    );
    const summary = JSON.parse(readFileSync(summaryJson, "utf8"));
    expect(summary.ok).toBe(true);
    expect(summary.totals).toEqual({ ok: 2, failed: 0, missing: 0 });
    expect(summary.perKind).toEqual({
      failure: { ok: 2, failed: 0, missing: 0 },
    });
  });

  it("MULTIPLE distinct files of the same kind aggregate under one per-kind bucket", () => {
    const a = join(dir, "parity-breakdown.json");
    const b = join(dir, "i18n-parity-breakdown-ubuntu.json");
    const c = join(dir, "cli-parity-breakdown-macos.json");
    for (const f of [a, b, c]) writeFileSync(f, JSON.stringify(validPayload()));
    const summaryJson = join(dir, "summary-multi-parity.json");

    execSync(
      `bun run ${SCRIPT} ${a} ${b} ${c} --summary-json ${summaryJson}`,
      { encoding: "utf8" },
    );
    const summary = JSON.parse(readFileSync(summaryJson, "utf8"));
    // All three landed in the SAME bucket — not three separate ones.
    expect(Object.keys(summary.perKind)).toEqual(["parity"]);
    expect(summary.perKind.parity).toEqual({ ok: 3, failed: 0, missing: 0 });
    expect(summary.totals).toEqual({ ok: 3, failed: 0, missing: 0 });
  });

  it("mixed ok + failed for the same kind accumulate accurately", () => {
    const good = join(dir, "flags-breakdown.json");
    const bad = join(dir, "cli-flags-breakdown-ubuntu.json");
    writeFileSync(good, JSON.stringify(validPayload()));
    writeFileSync(bad, JSON.stringify(badPayload()));
    const summaryJson = join(dir, "summary-mixed-flags.json");

    let exitCode = 0;
    try {
      execSync(
        `bun run ${SCRIPT} ${good} ${bad} --summary-json ${summaryJson}`,
        { encoding: "utf8", stdio: "pipe" },
      );
    } catch (e: any) {
      exitCode = e.status ?? 1;
    }
    // One file failed → CLI exits non-zero overall.
    expect(exitCode).not.toBe(0);

    const summary = JSON.parse(readFileSync(summaryJson, "utf8"));
    expect(summary.ok).toBe(false);
    expect(summary.perKind).toEqual({
      flags: { ok: 1, failed: 1, missing: 0 },
    });
    expect(summary.totals).toEqual({ ok: 1, failed: 1, missing: 0 });
  });

  it("mixed ok + missing for the same kind (with --allow-missing) accumulate accurately", () => {
    const good = join(dir, "failure-breakdown.json");
    writeFileSync(good, JSON.stringify(validPayload()));
    const absent = join(dir, "my-failure-breakdown-windows.json"); // not created
    const summaryJson = join(dir, "summary-allow-missing-same-kind.json");

    execSync(
      `bun run ${SCRIPT} ${good} ${absent} --allow-missing --summary-json ${summaryJson}`,
      { encoding: "utf8" },
    );
    const summary = JSON.parse(readFileSync(summaryJson, "utf8"));
    expect(summary.ok).toBe(true);
    expect(summary.perKind).toEqual({
      failure: { ok: 1, failed: 0, missing: 1 },
    });
    expect(summary.totals).toEqual({ ok: 1, failed: 0, missing: 1 });
  });

  it("repeated inputs across multiple kinds remain bucketed correctly (no cross-talk)", () => {
    const f1 = join(dir, "failure-breakdown.json");
    const f2 = join(dir, "another-failure-breakdown.json");
    const p1 = join(dir, "parity-breakdown.json");
    const fl1 = join(dir, "flags-breakdown.json");
    const fl2 = join(dir, "cli-flags-breakdown.json");
    for (const f of [f1, f2, p1, fl1, fl2]) {
      writeFileSync(f, JSON.stringify(validPayload()));
    }
    const summaryJson = join(dir, "summary-cross-talk.json");

    execSync(
      `bun run ${SCRIPT} ${f1} ${fl1} ${f2} ${p1} ${fl2} --summary-json ${summaryJson}`,
      { encoding: "utf8" },
    );
    const summary = JSON.parse(readFileSync(summaryJson, "utf8"));
    expect(summary.ok).toBe(true);
    expect(summary.perKind).toEqual({
      failure: { ok: 2, failed: 0, missing: 0 },
      parity: { ok: 1, failed: 0, missing: 0 },
      flags: { ok: 2, failed: 0, missing: 0 },
    });
    expect(summary.totals).toEqual({ ok: 5, failed: 0, missing: 0 });
  });
});
