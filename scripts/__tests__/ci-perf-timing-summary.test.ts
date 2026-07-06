// Unit tests for the CI per-test timing summary: verifies Playwright's
// `timing` annotation from the reduced-motion spec and Vitest's per-task
// durations from the README smoke both surface as timing rows in the
// rendered markdown table.
import { describe, expect, it } from "vitest";
import {
  parsePlaywright, parsePlaywrightFailedArtifacts, parseVitest,
  renderFailedArtifactLinks, renderMarkdown, renderS3Markdown,
  type S3RetrySample,
} from "../ci-perf-timing-summary";

describe("parsePlaywright — reduced-motion timing", () => {
  it("extracts shape name + total ms from the `timing` annotation", () => {
    const rows = parsePlaywright({
      suites: [{
        specs: [{
          title: "reduced-motion", file: "e2e/codemirror-reduced-motion-selection.spec.ts",
          tests: [{
            title: "stays stable — long-note", projectName: "chromium",
            annotations: [{ type: "timing", description: "long-note: total=1234ms, selected=500chars, cls=0.0012, scrollTop=420" }],
            results: [{ duration: 1300, status: "passed" }],
          }],
        }],
      }],
    });
    expect(rows).toEqual([{
      suite: "reduced-motion", name: "long-note", project: "chromium",
      durationMs: 1234, status: "passed",
      extra: "selected=500chars, cls=0.0012, scrollTop=420",
    }]);
  });

  it("falls back to Playwright's result.duration when annotation is missing", () => {
    const rows = parsePlaywright({
      suites: [{ specs: [{
        title: "s", file: "e2e/codemirror-reduced-motion-selection.spec.ts",
        tests: [{ title: "no-anno", results: [{ duration: 987, status: "passed" }] }],
      }] }],
    });
    expect(rows[0]).toMatchObject({ suite: "reduced-motion", name: "no-anno", durationMs: 987 });
  });

  it("ignores unrelated specs", () => {
    const rows = parsePlaywright({
      suites: [{ specs: [{ title: "other", file: "e2e/i18n.spec.ts", tests: [{ title: "x", results: [{ duration: 5 }] }] }] }],
    });
    expect(rows).toEqual([]);
  });
});

describe("parseVitest — README smoke timing", () => {
  it("collects per-test durations for the smoke file only", () => {
    const rows = parseVitest({
      files: [
        { filepath: "/repo/scripts/__tests__/readme-ci-download-walkthrough-smoke.test.ts",
          tasks: [{ name: "smoke", tasks: [
            { name: "downloads artifact", result: { duration: 82, state: "pass" } },
            { name: "verifies checksums", result: { duration: 41, state: "pass" } },
          ] }] },
        { filepath: "/repo/scripts/__tests__/unrelated.test.ts",
          tasks: [{ name: "x", result: { duration: 999, state: "pass" } }] },
      ],
    });
    expect(rows).toEqual([
      { suite: "readme-smoke", name: "downloads artifact", durationMs: 82, status: "pass" },
      { suite: "readme-smoke", name: "verifies checksums", durationMs: 41, status: "pass" },
    ]);
  });
});

describe("renderMarkdown — grouped table", () => {
  it("renders a markdown table per suite, sorted slowest-first", () => {
    const md = renderMarkdown([
      { suite: "reduced-motion", name: "a", durationMs: 100 },
      { suite: "reduced-motion", name: "b", durationMs: 500 },
      { suite: "readme-smoke", name: "c", durationMs: 50 },
    ]);
    expect(md).toContain("#### reduced-motion");
    expect(md).toContain("#### readme-smoke");
    // slowest row first within reduced-motion
    const rm = md.slice(md.indexOf("#### reduced-motion"));
    expect(rm.indexOf("| b |")).toBeLessThan(rm.indexOf("| a |"));
  });

  it("degrades gracefully when there are no rows", () => {
    expect(renderMarkdown([])).toContain("no timing rows collected");
  });
});
