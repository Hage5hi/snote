// Unit tests for the CI per-test timing summary: verifies Playwright's
// `timing` annotation from the reduced-motion spec and Vitest's per-task
// durations from the README smoke both surface as timing rows in the
// rendered markdown table.
import { describe, expect, it } from "vitest";
import {
  parsePlaywright, parsePlaywrightFailedArtifacts, parseVitest,
  renderFailedArtifactLinks, renderMarkdown, renderS3Markdown,
  renderWheelDiagnosticsReplayCommand, renderWheelLocalReproCommand,
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

describe("renderS3Markdown — retry stats", () => {
  const samples: S3RetrySample[] = [
    { key: "a/1", attempt: 1, delayMs: 80,   category: "http-throttle" },
    { key: "a/2", attempt: 2, delayMs: 220,  category: "http-throttle" },
    { key: "a/3", attempt: 3, delayMs: 900,  category: "http-throttle" },
    { key: "b/1", attempt: 1, delayMs: 1500, category: "http-5xx" },
    { key: "b/2", attempt: 2, delayMs: 4500, category: "http-5xx" },
    { key: "c/1", attempt: 1, delayMs: 300,  category: "network" },
    { key: "d/1", attempt: 1, delayMs: 8000, category: "timeout" },
  ];
  const md = renderS3Markdown(samples);

  it("summarises p50 / p95 / worst delay across all retries", () => {
    // sorted delays: 80,220,300,900,1500,4500,8000 → p50 idx floor(3.5)=3 → 900, p95 idx floor(6.65)=6 → 8000
    expect(md).toContain("**Total retries:** 7");
    expect(md).toContain("**p50:** 900ms");
    expect(md).toContain("**p95:** 8000ms");
    expect(md).toContain("**worst:** 8000ms");
  });

  it("renders histogram buckets that cover every sample exactly once", () => {
    // Expected bucket counts across edges [0,100,250,500,1000,2000,5000,10000,∞):
    // 0–100:1, 100–250:1, 250–500:2 (300,220? no 220<250 → 100–250:2, 300 in 250-500)
    // Recompute: 80→0-100, 220→100-250, 300→250-500, 900→500-1000, 1500→1000-2000, 4500→2000-5000, 8000→5000-10000
    expect(md).toContain("| 0–100ms | 1 |");
    expect(md).toContain("| 100–250ms | 1 |");
    expect(md).toContain("| 250–500ms | 1 |");
    expect(md).toContain("| 500–1000ms | 1 |");
    expect(md).toContain("| 1000–2000ms | 1 |");
    expect(md).toContain("| 2000–5000ms | 1 |");
    expect(md).toContain("| 5000–10000ms | 1 |");
  });

  it("renders per-category totals with worst delay + example key", () => {
    // http-throttle: 3 rows, worst=900 (key a/3)
    expect(md).toMatch(/\| http-throttle \| 3 \| 900 \| `a\/3` \|/);
    // http-5xx: 2 rows, worst=4500 (key b/2)
    expect(md).toMatch(/\| http-5xx \| 2 \| 4500 \| `b\/2` \|/);
    // timeout: 1 row, worst=8000 (key d/1)
    expect(md).toMatch(/\| timeout \| 1 \| 8000 \| `d\/1` \|/);
  });

  it("returns empty string when there were no retries", () => {
    expect(renderS3Markdown([])).toBe("");
  });
});

describe("failed-test artifact links", () => {
  const pwReport = {
    suites: [{ specs: [{
      title: "s", file: "e2e/note-wheel-trackpad-scroll.spec.ts",
      tests: [{
        title: "discrete wheel ticks all register", projectName: "chromium",
        results: [{
          status: "failed",
          retry: 1,
          attachments: [
            { name: "trace", path: "test-results/note-wheel/trace.zip" },
            { name: "wheel-diagnostics.json", path: "test-results/note-wheel/wheel-diagnostics.json" },
            { name: "scroller.png", path: "test-results/note-wheel/scroller.png" },
            { name: "video", path: "test-results/note-wheel/video.webm" }, // filtered out
          ],
        }],
      }],
    }] }],
  };

  it("collects only trace/png/json attachments for non-passing tests", () => {
    const failed = parsePlaywrightFailedArtifacts(pwReport);
    expect(failed).toHaveLength(1);
    expect(failed[0].attachments.map((a) => a.label).sort())
      .toEqual(["scroller.png", "trace", "wheel-diagnostics.json"]);
    expect(failed[0].retry).toBe(1);
  });

  it("renders clickable per-attachment links plus a run-artifacts URL", () => {
    const md = renderFailedArtifactLinks(parsePlaywrightFailedArtifacts(pwReport), {
      serverUrl: "https://github.com", repository: "acme/notes",
      runId: "42", runAttempt: "2", playwrightRetries: "2",
    });
    expect(md).toContain("[workflow run's Artifacts panel](https://github.com/acme/notes/actions/runs/42/attempts/2#artifacts)");
    expect(md).toContain("[trace](test-results/note-wheel/trace.zip)");
    expect(md).toContain("[wheel-diagnostics.json](test-results/note-wheel/wheel-diagnostics.json)");
    expect(md).toContain("[scroller.png](test-results/note-wheel/scroller.png)");
    expect(md).toContain("retry #1");
    expect(md).toContain("Local repro: `PLAYWRIGHT_PROJECT=chromium RETRIES=2 ./scripts/run-wheel-e2e.sh`");
    expect(md).toContain("Replay artifact: `PLAYWRIGHT_PROJECT=chromium bun run scripts/replay-wheel-diagnostics.ts test-results/note-wheel/wheel-diagnostics.json`");
  });

  it("renders the wheel local repro command with project + retries", () => {
    expect(renderWheelLocalReproCommand(parsePlaywrightFailedArtifacts(pwReport)[0], "3"))
      .toBe("PLAYWRIGHT_PROJECT=chromium RETRIES=3 ./scripts/run-wheel-e2e.sh");
  });

  it("renders the single-artifact wheel diagnostics replay command", () => {
    expect(renderWheelDiagnosticsReplayCommand(parsePlaywrightFailedArtifacts(pwReport)[0]))
      .toBe("PLAYWRIGHT_PROJECT=chromium bun run scripts/replay-wheel-diagnostics.ts test-results/note-wheel/wheel-diagnostics.json");
  });

  it("keeps wheel-diagnostics links schema-version agnostic", () => {
    const failed = parsePlaywrightFailedArtifacts({ suites: [{ specs: [{
      title: "s", file: "e2e/note-wheel-trackpad-scroll.spec.ts",
      tests: [{ title: "new schema", projectName: "webkit", results: [{
        status: "failed",
        attachments: [{ name: "wheel-diagnostics.json", path: "test-results/wheel-latest/new-schema/wheel-diagnostics.json" }],
      }] }],
    }] }] });
    const md = renderFailedArtifactLinks(failed, { playwrightRetries: "2" });
    expect(md).toContain("[wheel-diagnostics.json](test-results/wheel-latest/new-schema/wheel-diagnostics.json)");
    expect(md).toContain("PLAYWRIGHT_PROJECT=webkit RETRIES=2 ./scripts/run-wheel-e2e.sh");
  });

  it("returns empty string when there are no failed tests", () => {
    expect(renderFailedArtifactLinks([])).toBe("");
  });
});
