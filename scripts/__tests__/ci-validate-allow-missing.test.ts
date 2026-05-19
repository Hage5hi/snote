// Verifies that --allow-missing makes a missing breakdown file an
// allowed condition (validator exits 0 + summary.ok=true) so the PR
// comment renders artifact links for the breakdowns that DID upload,
// while degrading the missing slot to the "artifact not uploaded for
// this run" form. Mirrors the CI contract: --allow-missing means
// "optional, don't fail the gate", NOT "suppress every link".
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildCoverageComment } from "../ci-build-coverage-pr-comment";
import { FAILURE_BREAKDOWN_SCHEMA_VERSION } from "../ci-vitest-failure-summary";

const SCRIPT = resolve(__dirname, "../ci-validate-breakdown-json.ts");
const RUN = "https://github.com/o/r/actions/runs/42";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ci-allow-missing-"));
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

describe("ci-validate-breakdown-json --allow-missing — unit", () => {
  it("exits 0 + records missing in summary-json when a file is absent", () => {
    const present = join(dir, "failure-breakdown.json");
    writeFileSync(present, JSON.stringify(validPayload()));
    const absent = join(dir, "parity-breakdown.json"); // intentionally NOT created
    const summaryJson = join(dir, "summary-allow-missing.json");

    let exitCode = 0;
    try {
      execSync(
        `bun run ${SCRIPT} ${present} ${absent} --allow-missing --summary-json ${summaryJson}`,
        { encoding: "utf8" },
      );
    } catch (e: any) {
      exitCode = e.status ?? 1;
    }
    expect(exitCode).toBe(0);

    const summary = JSON.parse(readFileSync(summaryJson, "utf8"));
    expect(summary.ok).toBe(true);
    expect(summary.totals).toEqual({ ok: 1, failed: 0, missing: 1 });
    expect(summary.perKind.failure).toEqual({ ok: 1, failed: 0, missing: 0 });
    expect(summary.perKind.parity).toEqual({ ok: 0, failed: 0, missing: 1 });
  });

  it("WITHOUT --allow-missing, the same missing file fails the validator", () => {
    const present = join(dir, "failure-breakdown.json");
    writeFileSync(present, JSON.stringify(validPayload()));
    const absent = join(dir, "parity-breakdown.json");
    const summaryJson = join(dir, "summary-no-allow-missing.json");

    let exitCode = 0;
    try {
      execSync(
        `bun run ${SCRIPT} ${present} ${absent} --summary-json ${summaryJson}`,
        { encoding: "utf8", stdio: "pipe" },
      );
    } catch (e: any) {
      exitCode = e.status ?? 1;
    }
    expect(exitCode).not.toBe(0);

    const summary = JSON.parse(readFileSync(summaryJson, "utf8"));
    expect(summary.ok).toBe(false);
    expect(summary.totals.failed).toBeGreaterThan(0);
  });
});

describe("--allow-missing integration with PR comment — links still render", () => {
  it("validator passes with --allow-missing → comment renders links for present artifacts + degrades the missing slot only", () => {
    const present = join(dir, "failure-breakdown.json");
    writeFileSync(present, JSON.stringify(validPayload()));
    const absent = join(dir, "parity-breakdown.json");
    const summaryJson = join(dir, "summary-integ.json");

    execSync(
      `bun run ${SCRIPT} ${present} ${absent} --allow-missing --summary-json ${summaryJson}`,
      { encoding: "utf8" },
    );

    // Validator exited 0 → CI sets VALIDATE_OUTCOME=success. The
    // workflow then passes the artifact ids it DID get (the absent
    // file simply has no artifact id assigned to it).
    const summary = JSON.parse(readFileSync(summaryJson, "utf8"));
    expect(summary.ok).toBe(true);

    const body = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov-1",
      debugBundleArtifactId: "deb-1",
      stepSummaryArtifactId: "step-1",
      // failure-breakdown was present + uploaded → id present.
      failureBreakdownArtifactId: "fb-1",
    });

    // Every present-artifact link renders normally — --allow-missing
    // does NOT suppress them like a validator failure would.
    expect(body).toContain(`${RUN}/artifacts/cov-1`);
    expect(body).toContain(`${RUN}/artifacts/deb-1`);
    expect(body).toContain(`${RUN}/artifacts/step-1`);
    expect(body).toContain(`${RUN}/artifacts/fb-1`);
    expect(body).not.toContain("Breakdown JSON validation failed");

    // And a separate run where the failure-breakdown artifact id is
    // missing (matching the "absent" file case) degrades ONLY that
    // slot — every other link still renders.
    const partial = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: "cov-1",
      debugBundleArtifactId: "deb-1",
      stepSummaryArtifactId: "step-1",
      failureBreakdownArtifactId: undefined,
    });
    expect(partial).toContain(`${RUN}/artifacts/cov-1`);
    expect(partial).toContain(`${RUN}/artifacts/deb-1`);
    expect(partial).toContain(`${RUN}/artifacts/step-1`);
    expect(partial).toContain(
      "_🧩 failure-breakdown.json: artifact not uploaded for this run_",
    );
    expect(partial).not.toContain("Breakdown JSON validation failed");
  });
});
