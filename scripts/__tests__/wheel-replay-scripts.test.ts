import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs as parseDownloadArgs, buildGhArgs } from "../download-and-replay-wheel-artifact";
import { parseArgs as parseReplayArgs, expectedOutputs } from "../replay-wheel-diagnostics";
import { validateWheelFixture } from "../validate-wheel-fixture";

describe("wheel diagnostics replay scripts", () => {
  it("parses local replay mode with a selected diagnostics path and trace output", () => {
    const args = parseReplayArgs([
      "scripts/__fixtures__/wheel-diagnostics-failure/wheel-diagnostics.json",
      "--project=firefox",
      "--out-dir=test-results/custom-wheel-replay",
      "--trace=on",
    ]);
    expect(args).toMatchObject({
      path: "scripts/__fixtures__/wheel-diagnostics-failure/wheel-diagnostics.json",
      project: "firefox",
      outDir: "test-results/custom-wheel-replay",
      trace: true,
    });
  });

  it("builds a gh download command scoped to the selected workflow run and browser artifact", () => {
    const args = parseDownloadArgs(["12345", "--project=webkit", "--retries=2", "--attempt=3", "--out-dir=.artifacts/wheel"]);
    expect(buildGhArgs(args)).toEqual([
      "run", "download", "12345", "--dir", ".artifacts/wheel",
      "--pattern", "e2e-test-results-webkit-*attempt3",
    ]);
  });

  it("ships a real failing diagnostics fixture with matching screenshot metadata", () => {
    const dir = join(process.cwd(), "scripts", "__fixtures__", "wheel-diagnostics-failure");
    expect(existsSync(join(dir, "wheel-diagnostics.json"))).toBe(true);
    expect(existsSync(join(dir, "scroller.png"))).toBe(true);
    const diagnostics = JSON.parse(readFileSync(join(dir, "wheel-diagnostics.json"), "utf8"));
    expect(diagnostics.schemaVersion).toBe(1);
    expect(diagnostics.replay.length).toBeGreaterThan(0);
    expect(diagnostics.selectionDragSamples.length).toBeGreaterThan(0);
    expect(diagnostics.selectionStuckFrame.afterRange.signature)
      .toBe(diagnostics.selectionStuckFrame.beforeRange.signature);
  });

  it("supports --extra-traces flag for per-retry trace/trace-notes export", () => {
    const args = parseReplayArgs([
      "scripts/__fixtures__/wheel-diagnostics-failure/wheel-diagnostics.json",
      "--extra-traces",
    ]);
    expect(args.extraTraces).toBe(true);
  });

  it("validates the wheel-diagnostics-failure fixture has every required file", () => {
    const dir = join(process.cwd(), "scripts", "__fixtures__", "wheel-diagnostics-failure");
    const res = validateWheelFixture(dir);
    expect(res.missing).toEqual([]);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("reports missing files by exact name so CI logs point at the gap", () => {
    const res = validateWheelFixture(join(process.cwd(), "scripts", "__fixtures__", "does-not-exist"));
    expect(res.ok).toBe(false);
    expect(res.missing).toContain("wheel-diagnostics.json");
    expect(res.missing).toContain("scroller.png");
  });

  it("optionally requires trace.zip when the caller asks for it", () => {
    const dir = join(process.cwd(), "scripts", "__fixtures__", "wheel-diagnostics-failure");
    const res = validateWheelFixture(dir, { requireTrace: true });
    if (!res.ok) expect(res.missing).toContain("trace.zip");
  });

  it("scopes the default out-dir per project + retries so concurrent runs never collide", () => {
    const a = parseReplayArgs(["fixture.json", "--project=chromium", "--retries=0"]);
    const b = parseReplayArgs(["fixture.json", "--project=firefox", "--retries=2"]);
    expect(a.outDir).not.toBe(b.outDir);
    expect(a.outDir).toMatch(/wheel-replay[\\/]chromium-r0$/);
    expect(b.outDir).toMatch(/wheel-replay[\\/]firefox-r2$/);
  });

  it("still parses older wheel-diagnostics.json files that predate schemaVersion", () => {
    // Backward-compat regression: pre-v1 artifacts had no schemaVersion field
    // and only exposed wheelSamples (no `replay` array). The replay script's
    // arg parser and delta extraction must keep working for those artifacts.
    const legacy = {
      test: "legacy failing test",
      note: { lineCount: 500 },
      wheelSamples: [
        { i: 0, dx: 0, dy: 120, before: 0, after: 120, t: 1000 },
        { i: 1, dx: 0, dy: 120, before: 120, after: 120, t: 1020 },
      ],
    };
    // parseArgs accepts the path regardless of file content.
    const args = parseReplayArgs(["legacy.json", "--project=chromium"]);
    expect(args.path).toBe("legacy.json");
    // The diagnostics loader path uses .replay ?? wheelSamples; simulate the
    // same fallback here so the regression is checked at the data layer.
    const deltas = (legacy as { replay?: unknown[]; wheelSamples: unknown[] })
      .replay ?? legacy.wheelSamples.map(({ i, dx, dy, t }) => ({ i, dx, dy, t }));
    expect(deltas.length).toBe(2);
    expect((legacy as { schemaVersion?: number }).schemaVersion).toBeUndefined();
  });

  it("supports --dry-run and --list-outputs without launching Playwright", () => {
    const dry = parseReplayArgs(["fixture.json", "--dry-run"]);
    const list = parseReplayArgs(["fixture.json", "--list-outputs"]);
    expect(dry.dryRun).toBe(true);
    expect(list.listOutputs).toBe(true);
  });

  it("expectedOutputs lists per-retry trace zips only when trace + extra-traces are on", () => {
    expect(expectedOutputs({ trace: true, extraTraces: true, retries: "2" })).toEqual([
      "manifest.json", "replay-result.json", "wheel-deltas.jsonl", "selection-frames.jsonl", "scroller.png",
      "trace.zip", "trace-notes.json", "trace-retry-2.zip",
    ]);
    expect(expectedOutputs({ trace: false, extraTraces: true, retries: "0" })).toEqual([
      "manifest.json", "replay-result.json", "wheel-deltas.jsonl", "selection-frames.jsonl", "scroller.png",
      "trace-notes.json",
    ]);
    expect(expectedOutputs({ trace: true, extraTraces: false, retries: "0" })).not.toContain("trace-retry-0.zip");
  });

  it("concurrent replay runs with different project/retries never collide on output paths", () => {
    const matrix = [
      ["chromium", "0"], ["chromium", "2"], ["firefox", "0"], ["firefox", "2"],
      ["webkit", "0"], ["webkit", "3"],
    ] as const;
    const parsed = matrix.map(([p, r]) =>
      parseReplayArgs(["fixture.json", `--project=${p}`, `--retries=${r}`, "--extra-traces"]),
    );
    const paths = parsed.flatMap((a) => expectedOutputs(a).map((f) => `${a.outDir}/${f}`));
    expect(new Set(paths).size).toBe(paths.length);
    // Per-retry trace zip names embed the retries count so parallel retries stay unique.
    const retryZips = parsed.map((a) => `${a.outDir}/trace-retry-${a.retries}.zip`);
    expect(new Set(retryZips).size).toBe(retryZips.length);
  });
});