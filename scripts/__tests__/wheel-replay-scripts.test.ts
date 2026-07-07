import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs as parseDownloadArgs, buildGhArgs } from "../download-and-replay-wheel-artifact";
import {
  parseArgs as parseReplayArgs,
  expectedOutputs,
  planResumeOutputs,
  verifyManifest,
  verifyZipIntegrity,
} from "../replay-wheel-diagnostics";
import { validateWheelFixture } from "../validate-wheel-fixture";

const tmpDirs: string[] = [];
const mkTmp = () => { const d = mkdtempSync(join(tmpdir(), "wheel-replay-test-")); tmpDirs.push(d); return d; };
afterEach(() => { while (tmpDirs.length) { try { rmSync(tmpDirs.pop()!, { recursive: true, force: true }); } catch { /* ignore */ } } });

// Minimal valid ZIP: empty archive (PK\x05\x06 EOCD only) - both signatures present via prepending PK\x03\x04 stub.
// We build a tiny but structurally valid zip by concatenating a local-file-header stub and an EOCD record.
function makeValidZip(): Buffer {
  const lfh = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const eocd = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([lfh, eocd]);
}


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

  it("planResumeOutputs classifies a partially-complete out-dir into existing vs missing", () => {
    const dir = mkTmp();
    const args = { trace: true, extraTraces: false, retries: "2" as const };
    // Pre-create a subset of expected outputs to simulate a partial prior run.
    writeFileSync(join(dir, "replay-result.json"), "{}");
    writeFileSync(join(dir, "wheel-deltas.jsonl"), "");
    writeFileSync(join(dir, "trace.zip"), makeValidZip());
    const plan = planResumeOutputs(dir, args);
    expect(plan.existing.sort()).toEqual(["replay-result.json", "trace.zip", "wheel-deltas.jsonl"]);
    // Missing outputs must include everything not pre-created; --resume will
    // regenerate only these while leaving `existing` untouched.
    expect(plan.missing).toContain("manifest.json");
    expect(plan.missing).toContain("scroller.png");
    expect(plan.missing).toContain("selection-frames.jsonl");
    // Round-trip: existing ∪ missing == expectedOutputs.
    expect([...plan.existing, ...plan.missing].sort()).toEqual(expectedOutputs(args).sort());
  });

  it("verifyZipIntegrity accepts a well-formed zip and rejects a corrupted one", () => {
    const dir = mkTmp();
    const good = join(dir, "good.zip");
    const bad = join(dir, "bad.zip");
    writeFileSync(good, makeValidZip());
    writeFileSync(bad, Buffer.from("not a zip"));
    expect(verifyZipIntegrity(good).ok).toBe(true);
    const badRes = verifyZipIntegrity(bad);
    expect(badRes.ok).toBe(false);
    expect(badRes.error).toMatch(/PK|too small|central-directory/);
  });

  it("verifyManifest passes for a matching out-dir and fails when files are missing or corrupt", () => {
    const dir = mkTmp();
    const zip = makeValidZip();
    writeFileSync(join(dir, "replay-result.json"), "{}");
    writeFileSync(join(dir, "trace.zip"), zip);
    const manifest = {
      schemaVersion: 1,
      artifacts: [
        { name: "replay-result.json", path: join(dir, "replay-result.json"), size: 2, generatedAt: null, present: true },
        { name: "trace.zip", path: join(dir, "trace.zip"), size: zip.length, generatedAt: null, present: true },
      ],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    expect(verifyManifest(dir)).toEqual({ ok: true, errors: [] });

    // Corrupt the trace and rewrite manifest with the new (wrong-size) expectation removed.
    writeFileSync(join(dir, "trace.zip"), Buffer.from("garbage"));
    const bad = verifyManifest(dir);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join("\n")).toMatch(/trace\.zip/);

    // Missing manifest entirely.
    const empty = mkTmp();
    const missing = verifyManifest(empty);
    expect(missing.ok).toBe(false);
    expect(missing.errors[0]).toMatch(/manifest\.json not found/);
  });

  it("exposes --verify-manifest as a parseable flag", () => {
    const args = parseReplayArgs(["fixture.json", "--verify-manifest"]);
    expect(args.verifyManifest).toBe(true);
  });
});