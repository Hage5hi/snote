// Integration tests for ci-validate-breakdown-json --summary-json:
//   1. running the CLI with --summary-json writes a JSON file to disk
//      that matches the expected SUMMARY_JSON= stdout marker (same
//      payload, machine-readable).
//   2. the CI workflow (.github/workflows/ci.yml) wires --summary-json
//      into the validate step AND uploads the resulting JSON as an
//      artifact gated on validation success — the upload step must be
//      conditional on `steps.validate_breakdown.outcome == 'success'`
//      so we never publish a summary describing a malformed payload.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FAILURE_BREAKDOWN_SCHEMA_VERSION } from "../ci-vitest-failure-summary";

const SCRIPT = resolve(__dirname, "../ci-validate-breakdown-json.ts");
const WORKFLOW = resolve(__dirname, "../../.github/workflows/ci.yml");

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ci-validate-summary-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const validPayload = (kind: "failure" | "parity" | "flags") => ({
  schemaVersion: FAILURE_BREAKDOWN_SCHEMA_VERSION,
  kind,
  failureCount: 0,
  suiteCount: 0,
  failures: [],
});

describe("ci-validate-breakdown-json --summary-json (disk output)", () => {
  it("writes a JSON file matching the SUMMARY_JSON= stdout marker", () => {
    const file = join(dir, "failure-breakdown.json");
    writeFileSync(file, JSON.stringify(validPayload("failure")));
    const summaryPath = join(dir, "validate-summary.json");

    const stdout = execSync(
      `bun run ${SCRIPT} ${file} --summary-json ${summaryPath}`,
      { encoding: "utf8" },
    );

    expect(existsSync(summaryPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(summaryPath, "utf8"));
    expect(onDisk).toMatchObject({
      schemaVersion: 1,
      ok: true,
      totals: { ok: 1, failed: 0, missing: 0 },
      perKind: { failure: { ok: 1, failed: 0, missing: 0 } },
    });

    const marker = stdout
      .split("\n")
      .find((l) => l.startsWith("SUMMARY_JSON="));
    expect(marker).toBeDefined();
    const fromStdout = JSON.parse(marker!.slice("SUMMARY_JSON=".length));
    expect(fromStdout).toEqual(onDisk);
  });

  it("aggregates per-kind counts across mixed files in one --summary-json", () => {
    const f = join(dir, "failure-breakdown.json");
    const p = join(dir, "parity-breakdown.json");
    const fl = join(dir, "flags-breakdown.json");
    writeFileSync(f, JSON.stringify(validPayload("failure")));
    writeFileSync(p, JSON.stringify(validPayload("parity")));
    writeFileSync(fl, JSON.stringify(validPayload("flags")));
    const summaryPath = join(dir, "validate-summary-multi.json");

    execSync(
      `bun run ${SCRIPT} ${f} ${p} ${fl} --summary-json ${summaryPath}`,
      { encoding: "utf8" },
    );

    const onDisk = JSON.parse(readFileSync(summaryPath, "utf8"));
    expect(onDisk.ok).toBe(true);
    expect(onDisk.totals).toEqual({ ok: 3, failed: 0, missing: 0 });
    expect(onDisk.perKind).toEqual({
      failure: { ok: 1, failed: 0, missing: 0 },
      parity: { ok: 1, failed: 0, missing: 0 },
      flags: { ok: 1, failed: 0, missing: 0 },
    });
  });
});

describe("ci.yml — validate-summary upload wiring", () => {
  const yaml = readFileSync(WORKFLOW, "utf8");

  it("passes --summary-json to the validate_breakdown step", () => {
    expect(yaml).toMatch(/ci-validate-breakdown-json\.ts[\s\S]*?--summary-json\s+reports\/_ci\/validate-summary\.json/);
  });

  it("uploads the validate-summary.json artifact only on validation success", () => {
    // Find the upload block by artifact name, then assert its `if:` gate
    // references the validate_breakdown step outcome being success.
    const idx = yaml.indexOf("i18n-cli-validate-summary-ubuntu-latest");
    expect(idx).toBeGreaterThan(-1);
    // The `if:` line lives a few lines above the `with:` block.
    const before = yaml.slice(Math.max(0, idx - 600), idx);
    expect(before).toMatch(/steps\.validate_breakdown\.outcome\s*==\s*'success'/);
    expect(before).toMatch(/uses:\s*actions\/upload-artifact@v4/);
  });

  it("uploads the validate-summary path that the validator writes to", () => {
    const idx = yaml.indexOf("i18n-cli-validate-summary-ubuntu-latest");
    const after = yaml.slice(idx, idx + 400);
    expect(after).toMatch(/path:\s*reports\/_ci\/validate-summary\.json/);
  });
});
