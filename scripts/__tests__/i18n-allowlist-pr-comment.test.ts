// Unit tests for the PR comment builder's CI-context resolver.
// Verifies graceful fallbacks + the exact list of missing env vars.
import { describe, expect, it } from "vitest";
import {
  REQUIRED_GH_ENV,
  build,
  buildUrls,
  resolveCIContext,
} from "../i18n-allowlist-pr-comment";

describe("resolveCIContext", () => {
  it("returns no missing entries when all GitHub vars are set", () => {
    const ctx = resolveCIContext({
      GITHUB_SERVER_URL: "https://github.example",
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_RUN_ID: "42",
      I18N_ARTIFACT_ID: "999",
    });
    expect(ctx.missing).toEqual([]);
    expect(ctx).toMatchObject({
      serverUrl: "https://github.example",
      repo: "owner/repo",
      runId: "42",
      artifactId: "999",
    });
  });

  it("lists exactly which required vars are missing (empty env)", () => {
    const ctx = resolveCIContext({});
    expect(ctx.missing.sort()).toEqual([...REQUIRED_GH_ENV].sort());
    // Fallbacks preserve URL-shape so links don't 404 the comment renderer.
    expect(ctx.serverUrl).toBe("https://github.com");
    expect(ctx.repo).toBe("<owner>/<repo>");
    expect(ctx.runId).toBe("0");
    expect(ctx.artifactId).toBe("");
  });

  it("treats empty / whitespace-only values as missing", () => {
    const ctx = resolveCIContext({
      GITHUB_SERVER_URL: "",
      GITHUB_REPOSITORY: "   ",
      GITHUB_RUN_ID: "1",
      I18N_ARTIFACT_ID: "   ",
    });
    expect(ctx.missing.sort()).toEqual(
      ["GITHUB_REPOSITORY", "GITHUB_SERVER_URL"].sort(),
    );
    expect(ctx.runId).toBe("1");
    // Whitespace-only artifact id ⇒ degrades to empty, but is NOT tracked
    // in `missing` (it's optional).
    expect(ctx.artifactId).toBe("");
    expect(ctx.missing).not.toContain("I18N_ARTIFACT_ID");
  });

  it("flags exactly one missing var when only one is unset", () => {
    const ctx = resolveCIContext({
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "o/r",
      // GITHUB_RUN_ID intentionally absent
    });
    expect(ctx.missing).toEqual(["GITHUB_RUN_ID"]);
  });
});

describe("buildUrls", () => {
  it("uses /artifacts/<id> when artifactId is present", () => {
    const ctx = resolveCIContext({
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_RUN_ID: "5",
      I18N_ARTIFACT_ID: "abc",
    });
    expect(buildUrls(ctx).bundleUrl).toBe(
      "https://github.com/o/r/actions/runs/5/artifacts/abc",
    );
  });

  it("falls back to run-level #artifacts when artifactId is missing", () => {
    const ctx = resolveCIContext({
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_RUN_ID: "5",
    });
    expect(buildUrls(ctx).bundleUrl).toBe(
      "https://github.com/o/r/actions/runs/5#artifacts",
    );
  });
});

describe("build (PR comment body)", () => {
  it("includes the missing-env-var notice listing exact names", () => {
    const ctx = resolveCIContext({});
    const md = build(ctx);
    expect(md).toContain("Some CI env vars were missing");
    for (const k of REQUIRED_GH_ENV) expect(md).toContain(k);
  });

  it("omits the missing-env-var notice when all vars are set", () => {
    const ctx = resolveCIContext({
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_RUN_ID: "7",
    });
    expect(build(ctx)).not.toContain("Some CI env vars were missing");
  });
});
