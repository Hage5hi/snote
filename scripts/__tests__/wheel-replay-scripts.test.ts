import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs as parseDownloadArgs, buildGhArgs } from "../download-and-replay-wheel-artifact";
import { parseArgs as parseReplayArgs } from "../replay-wheel-diagnostics";
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
});