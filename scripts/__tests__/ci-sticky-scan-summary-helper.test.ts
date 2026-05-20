// Verifies the test-helper telemetry surfaces:
//   • summarizeScan writes BOTH a `[sticky-scan]` log AND a
//     `[sticky-scan-json] {...}` machine-readable line when
//     STICKY_TEST_SUMMARY=1.
//   • A JSONL record is appended to the configured output path.
//   • Fuzz failures write a replay artifact JSON file with the
//     marker variant, normalization paths, and cleaned IDs (or null).
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFuzzWithSeed, summarizeScan } from "./_helpers/sticky-scan-summary";
import type { UpsertResult } from "../ci-sticky-pr-comment-upsert";

function fakeResult(over: Partial<UpsertResult> = {}): UpsertResult {
  return {
    action: "updated",
    comment: { id: 42, body: "x" },
    cleaned: [{ id: 7, via: "delete" }],
    usedFullScan: false,
    scanStats: { pagesWalked: 2, commentsExamined: 5, linesScanned: 13 },
    ...over,
  };
}

describe("sticky-scan-summary helper telemetry", () => {
  let tmp: string;
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const prevSummary = process.env.STICKY_TEST_SUMMARY;
  const prevJsonl = process.env.STICKY_SCAN_SUMMARY_JSONL;
  const prevDir = process.env.STICKY_FUZZ_ARTIFACT_DIR;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "sticky-summary-"));
    logs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...a) => {
      logs.push(a.join(" "));
    });
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.STICKY_SCAN_SUMMARY_JSONL = join(tmp, "scan.jsonl");
    process.env.STICKY_FUZZ_ARTIFACT_DIR = join(tmp, "fuzz");
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
    if (prevSummary == null) delete process.env.STICKY_TEST_SUMMARY;
    else process.env.STICKY_TEST_SUMMARY = prevSummary;
    if (prevJsonl == null) delete process.env.STICKY_SCAN_SUMMARY_JSONL;
    else process.env.STICKY_SCAN_SUMMARY_JSONL = prevJsonl;
    if (prevDir == null) delete process.env.STICKY_FUZZ_ARTIFACT_DIR;
    else process.env.STICKY_FUZZ_ARTIFACT_DIR = prevDir;
  });

  it("summarizeScan is a no-op when STICKY_TEST_SUMMARY is unset", () => {
    delete process.env.STICKY_TEST_SUMMARY;
    summarizeScan("noop case", fakeResult());
    expect(logs).toHaveLength(0);
    expect(existsSync(process.env.STICKY_SCAN_SUMMARY_JSONL!)).toBe(false);
  });

  it("emits both compact log and JSON line + appends JSONL when enabled", () => {
    process.env.STICKY_TEST_SUMMARY = "1";
    summarizeScan("case-A", fakeResult());
    summarizeScan(
      "case-B",
      fakeResult({ action: "created", comment: { id: 99, body: "y" }, cleaned: [] }),
    );
    const joined = logs.join("\n");
    expect(joined).toMatch(/\[sticky-scan\] case-A/);
    expect(joined).toMatch(/\[sticky-scan-json\] \{.*"label":"case-A"/);
    expect(joined).toMatch(/\[sticky-scan-json\] \{.*"label":"case-B"/);

    const raw = readFileSync(process.env.STICKY_SCAN_SUMMARY_JSONL!, "utf8");
    const lines = raw.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      schema: "sticky-scan-summary/v1",
      label: "case-A",
      action: "updated",
      id: 42,
      cleaned: 1,
      cleanedIds: [7],
      scanStats: { pagesWalked: 2, commentsExamined: 5, linesScanned: 13 },
    });
    expect(lines[1].label).toBe("case-B");
  });

  it("fuzz failure writes a JSON artifact with marker variant, paths, and cleanedIds", () => {
    expect(() =>
      runFuzzWithSeed({
        name: "demo-failure",
        seed: 12345,
        iterations: 3,
        rng: () => 0.5,
        body: (_rng, i, ctx) => {
          ctx.extra = {
            markerLiteral: "<!-- m -->",
            markerVariant: "<!-- m\uFEFF -->",
            paths: {
              headScan: { returned: false, threw: null },
              fullScan: { returned: false, threw: null },
            },
            cleanedIds: [1, 2, 3],
          };
          if (i === 1) throw new Error("boom");
        },
      }),
    ).toThrow(/boom/);

    const files = readdirSync(join(tmp, "fuzz"));
    expect(files.length).toBe(1);
    const record = JSON.parse(readFileSync(join(tmp, "fuzz", files[0]), "utf8"));
    expect(record).toMatchObject({
      schema: "sticky-fuzz-failure/v1",
      name: "demo-failure",
      seed: 12345,
      iteration: 1,
      error: "boom",
      inputs: {
        markerLiteral: "<!-- m -->",
        cleanedIds: [1, 2, 3],
        paths: {
          headScan: { returned: false, threw: null },
          fullScan: { returned: false, threw: null },
        },
      },
    });
    expect(record.reproduce).toMatch(/STICKY_FUZZ_SEED=12345/);
  });
});
