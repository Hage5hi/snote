// End-to-end CI smoke test: run the REAL validator CLI against
// realistic on-disk inputs, then upsert the PR comment via a mocked
// sticky-comment API (modeling marocchino/sticky-pull-request-comment).
// Asserts the full chain CI executes per run:
//
//   1. validator validates each *-breakdown.json + writes summary-json
//   2. summary-json describes ok=true totals + per-kind counts
//   3. buildCoverageComment(validateOutcome=success, …ids) renders a
//      body that links to every uploaded artifact
//   4. sticky upsert posts the body once, then UPDATES (never
//      duplicates) it on a rerun
//
// And the failure path:
//   • when one breakdown file is malformed → validator exits non-zero
//   • buildCoverageComment(validateOutcome=failure) suppresses all
//     artifact links, but the upload-style mock still lists every
//     uploaded artifact (mirroring `if: always()` in ci.yml).
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildCoverageComment } from "../ci-build-coverage-pr-comment";
import { FAILURE_BREAKDOWN_SCHEMA_VERSION } from "../ci-vitest-failure-summary";

const SCRIPT = resolve(__dirname, "../ci-validate-breakdown-json.ts");
const RUN = "https://github.com/o/r/actions/runs/42";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ci-smoke-"));
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

/** In-memory mock of the sticky PR comment action used by ci.yml. */
function makeSticky(header: string) {
  const marker = `<!-- Sticky Pull Request Comment${header} -->`;
  const comments: Array<{ id: number; body: string }> = [];
  let nextId = 1;
  const upsert = vi.fn(async (body: string) => {
    const prior = comments.find((c) => c.body.startsWith(marker));
    if (prior) {
      prior.body = `${marker}\n${body}`;
      return prior;
    }
    const c = { id: nextId++, body: `${marker}\n${body}` };
    comments.push(c);
    return c;
  });
  return { comments, upsert, marker };
}

/** Mock of actions/upload-artifact@v4 — records uploads + assigns ids. */
function makeUploads() {
  const uploaded: Array<{ name: string; paths: string[]; id: string }> = [];
  let next = 1;
  const upload = (name: string, paths: string[]) => {
    const id = `art-${next++}`;
    uploaded.push({ name, paths, id });
    return id;
  };
  return { uploaded, upload };
}

describe("CI smoke — happy path (all breakdowns valid)", () => {
  it("validates, writes summary-json, uploads artifacts, and upserts a clickable PR comment", async () => {
    const failure = join(dir, "failure-breakdown.json");
    const parity = join(dir, "parity-breakdown.json");
    const flags = join(dir, "flags-breakdown.json");
    for (const f of [failure, parity, flags]) {
      writeFileSync(f, JSON.stringify(validPayload()));
    }
    const summaryJson = join(dir, "validate-summary.json");

    // 1. Run the real validator CLI.
    execSync(
      `bun run ${SCRIPT} ${failure} ${parity} ${flags} --summary-json ${summaryJson}`,
      { encoding: "utf8" },
    );

    // 2. Summary on disk reflects ok=true with per-kind counts.
    const summary = JSON.parse(readFileSync(summaryJson, "utf8"));
    expect(summary.ok).toBe(true);
    expect(summary.totals).toEqual({ ok: 3, failed: 0, missing: 0 });
    expect(Object.keys(summary.perKind).sort()).toEqual([
      "failure",
      "flags",
      "parity",
    ]);

    // 3. Simulate the upload-artifact steps in ci.yml.
    const uploads = makeUploads();
    const debugId = uploads.upload("i18n-cli-debug-bundle-ubuntu-latest", [
      failure,
      parity,
      flags,
    ]);
    const stepId = uploads.upload("i18n-cli-step-summary-ubuntu-latest", [
      "reports/_ci/step-summary.md",
    ]);
    const fbId = uploads.upload(
      "i18n-cli-failure-breakdown-json-ubuntu-latest",
      [failure],
    );
    const covId = uploads.upload("i18n-cli-coverage-html", [
      "coverage/i18n-cli/",
    ]);
    expect(uploads.uploaded).toHaveLength(4);

    // 4. Build + upsert the sticky comment (first run → create).
    const sticky = makeSticky("i18n-cli-coverage");
    const body1 = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: covId,
      debugBundleArtifactId: debugId,
      stepSummaryArtifactId: stepId,
      failureBreakdownArtifactId: fbId,
    });
    await sticky.upsert(body1);
    expect(sticky.upsert).toHaveBeenCalledTimes(1);
    expect(sticky.comments).toHaveLength(1);
    expect(sticky.comments[0].body).toContain(`${RUN}/artifacts/${debugId}`);
    expect(sticky.comments[0].body).toContain(`${RUN}/artifacts/${covId}`);
    expect(sticky.comments[0].body).not.toContain("artifact not uploaded");

    // Rerun: upserts MUST replace the same comment (no duplicates).
    const body2 = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "success",
      coverageArtifactId: covId,
      debugBundleArtifactId: "deb-rerun",
      stepSummaryArtifactId: stepId,
      failureBreakdownArtifactId: fbId,
    });
    await sticky.upsert(body2);
    expect(sticky.comments).toHaveLength(1);
    expect(sticky.comments[0].body).toContain(`${RUN}/artifacts/deb-rerun`);
  });
});

describe("CI smoke — failure path (one breakdown malformed)", () => {
  it("validator fails, comment suppresses links, but uploads still happen (if: always)", async () => {
    const good = join(dir, "failure-breakdown.json");
    const bad = join(dir, "parity-breakdown.json");
    writeFileSync(good, JSON.stringify(validPayload()));
    writeFileSync(bad, JSON.stringify({ schemaVersion: 999 })); // wrong version + missing keys
    const summaryJson = join(dir, "validate-summary-fail.json");

    let exitCode = 0;
    try {
      execSync(
        `bun run ${SCRIPT} ${good} ${bad} --summary-json ${summaryJson}`,
        { encoding: "utf8", stdio: "pipe" },
      );
    } catch (e: any) {
      exitCode = e.status ?? 1;
    }
    expect(exitCode).not.toBe(0);

    // Summary JSON is still written so dashboards can ingest it.
    const summary = JSON.parse(readFileSync(summaryJson, "utf8"));
    expect(summary.ok).toBe(false);
    expect(summary.totals.failed).toBeGreaterThan(0);

    // Upload step is `if: always()` — uploads happen regardless.
    const uploads = makeUploads();
    const debugId = uploads.upload("i18n-cli-debug-bundle-ubuntu-latest", [
      good,
      bad,
    ]);
    expect(uploads.uploaded).toHaveLength(1);

    // Comment-build step receives validateOutcome=failure → suppresses
    // links even though the artifact id is non-empty.
    const sticky = makeSticky("i18n-cli-coverage");
    const body = buildCoverageComment({
      runUrl: RUN,
      validateOutcome: "failure",
      debugBundleArtifactId: debugId,
    });
    await sticky.upsert(body);
    expect(sticky.comments[0].body).toContain("Breakdown JSON validation failed");
    expect(sticky.comments[0].body).not.toContain(`/artifacts/${debugId}`);
  });
});
