// Integration test for the CI workflow's validator-failure → PR-comment
// gating. Asserts two related invariants that span ci.yml + the comment
// builder, so a refactor that breaks either side fails loudly:
//
//   1. When the validate_breakdown step fails, the workflow still runs
//      every artifact-upload step (they use `if: always()`), so the
//      artifacts remain downloadable from the run page even though the
//      sticky PR comment suppresses links to them.
//
//   2. The PR-comment-builder script, given VALIDATE_OUTCOME=failure,
//      produces a body that contains NO artifact links (full link
//      suppression) and includes a clear error pointing reviewers to
//      the run logs.
//
// (1) is verified by parsing the workflow YAML; (2) is verified by
// running the actual comment-builder script as a subprocess with the
// same env shape the workflow uses.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const CI_YML = readFileSync(".github/workflows/ci.yml", "utf8");
const SCRIPT = "scripts/ci-build-coverage-pr-comment.ts";

describe("CI workflow: validator-failed gating", () => {
  it("artifact uploads are gated by `if: always()` (not by validator success)", () => {
    // Pull out every `id: upload_*` step and confirm its enclosing
    // `if:` expression contains `always()` — so they fire regardless
    // of whether the breakdown validator passed.
    const uploadIds = [
      "upload_step_summary_md",
      "upload_failure_breakdown_json",
      "upload_debug_bundle",
    ];
    for (const id of uploadIds) {
      const re = new RegExp(
        `- if: ([^\\n]*always\\(\\)[^\\n]*)\\n\\s+id: ${id}`,
        "m",
      );
      expect(
        CI_YML,
        `expected upload step '${id}' to be gated by always() so artifacts upload even on validator failure`,
      ).toMatch(re);
    }
  });

  it("the sticky-comment step consumes VALIDATE_OUTCOME (so the gate is observable)", () => {
    expect(CI_YML).toMatch(
      /VALIDATE_OUTCOME:\s*\$\{\{\s*steps\.validate_breakdown\.outcome\s*\}\}/,
    );
  });

  it("validate_breakdown uses continue-on-error so the gate runs (not the whole job halting)", () => {
    expect(CI_YML).toMatch(
      /id:\s*validate_breakdown[\s\S]*?continue-on-error:\s*true/,
    );
  });
});

describe("CI workflow: PR-comment builder under validator failure", () => {
  it("suppresses ALL artifact links and explains why when VALIDATE_OUTCOME=failure", () => {
    const res = spawnSync("bun", ["run", SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_RUN_ID: "777",
        VALIDATE_OUTCOME: "failure",
        // Even with every artifact id populated, the failure variant
        // must NOT render any links to them.
        COVERAGE_ARTIFACT_ID: "cov",
        DEBUG_BUNDLE_ARTIFACT_ID: "deb",
        STEP_SUMMARY_ARTIFACT_ID: "step",
        FAILURE_BREAKDOWN_ARTIFACT_ID: "fb",
      },
    });
    expect(res.status).toBe(0);
    const body = res.stdout;
    expect(body).toContain("❌ **Breakdown JSON validation failed**");
    expect(body).toContain("artifact links are suppressed");
    // Critical: no /artifacts/<id> links bleed through.
    expect(body).not.toMatch(/\/artifacts\/(cov|deb|step|fb)/);
  });

  it("renders the full link block when VALIDATE_OUTCOME=success", () => {
    const res = spawnSync("bun", ["run", SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_RUN_ID: "777",
        VALIDATE_OUTCOME: "success",
        DEBUG_BUNDLE_ARTIFACT_ID: "deb",
      },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[📦 debug-bundle](https://github.com/o/r/actions/runs/777/artifacts/deb)");
    expect(res.stdout).not.toContain("Breakdown JSON validation failed");
  });
});
