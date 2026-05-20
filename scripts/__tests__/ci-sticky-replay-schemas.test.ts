// Unit tests for the strict JSON schema validators used by the
// sticky-replay and sticky-fuzz-replay CLIs before they write any
// `--json` output file.
import { describe, expect, it } from "vitest";
import {
  validateOverlapReplayResult,
  validateFuzzReplayResult,
  formatProblems,
} from "../_helpers/sticky-replay-schemas";

describe("validateOverlapReplayResult", () => {
  const good = {
    schema: "sticky-replay/v1",
    scenario: "overlap-dup-page",
    headScanLines: 5,
    strategy: "delete",
    action: "updated",
    selectedId: 900,
    cleanedIds: [500, 400],
    usedFullScan: false,
    scanStats: { pagesWalked: 2, commentsExamined: 4, linesScanned: 20 },
    finalIds: [900],
    timestamp: "2026-05-20T10:00:00Z",
  };

  it("accepts a fully-populated payload", () => {
    expect(validateOverlapReplayResult(good)).toEqual([]);
  });

  it("rejects a non-object root", () => {
    expect(validateOverlapReplayResult(null)).toEqual(["replay result is not a JSON object"]);
    expect(validateOverlapReplayResult(42)).toEqual(["replay result is not a JSON object"]);
  });

  it("names every missing or wrong-typed field", () => {
    const bad = { schema: "other/v1", scenario: 1, cleanedIds: "nope" };
    const problems = validateOverlapReplayResult(bad);
    const joined = problems.join("\n");
    expect(joined).toMatch(/schema=/);
    expect(joined).toMatch(/scenario is missing or not a string/);
    expect(joined).toMatch(/headScanLines is missing or not a number/);
    expect(joined).toMatch(/cleanedIds is missing or not a number\[\]/);
    expect(joined).toMatch(/usedFullScan is missing or not a boolean/);
    expect(joined).toMatch(/scanStats is missing or not an object/);
    expect(joined).toMatch(/finalIds is missing or not a number\[\]/);
    expect(joined).toMatch(/timestamp is missing or not a string/);
  });

  it("rejects cleanedIds containing non-numbers and includes the path + value snippet", () => {
    const problems = validateOverlapReplayResult({ ...good, cleanedIds: [1, "2"] });
    const joined = problems.join("\n");
    expect(joined).toMatch(/\.cleanedIds is missing or not a number\[\]/);
    // The received value snippet is included so reviewers can spot the bad item.
    expect(joined).toMatch(/got: \[1,"2"\]/);
  });

  it("includes a bounded snippet of huge values rather than dumping them", () => {
    const huge = "x".repeat(500);
    const problems = validateOverlapReplayResult({ ...good, scenario: huge as unknown });
    // String value is the right type — synthesize a wrong-typed field instead.
    const p2 = validateOverlapReplayResult({ ...good, headScanLines: huge });
    expect(p2.some((m) => m.includes("...") && m.length < 200)).toBe(true);
    expect(problems).toEqual([]);
  });
});

describe("validateFuzzReplayResult", () => {
  const good = {
    schema: "sticky-fuzz-replay/v1",
    source: "/tmp/a.json",
    artifact: { seed: 1 },
    inputs: { markerLiteral: "<!-- m -->", bodyLength: 12 },
    matcher: {
      headScan: { returned: true, threw: null },
      fullScan: { returned: true, threw: null },
    },
    capturedAtFailure: { cleanedIds: [1, 2] },
    timestamp: "2026-05-20T10:00:00Z",
  };

  it("accepts a fully-populated payload", () => {
    expect(validateFuzzReplayResult(good)).toEqual([]);
  });

  it("flags missing matcher sub-objects and inputs fields", () => {
    const bad = { schema: "sticky-fuzz-replay/v1", inputs: {}, matcher: {} };
    const problems = validateFuzzReplayResult(bad);
    const joined = problems.join("\n");
    expect(joined).toMatch(/inputs\.markerLiteral is missing/);
    expect(joined).toMatch(/inputs\.bodyLength is missing/);
    expect(joined).toMatch(/matcher\.headScan is missing/);
    expect(joined).toMatch(/matcher\.fullScan is missing/);
  });
});

describe("formatProblems", () => {
  it("produces a clear multi-line error with the kind and path", () => {
    const msg = formatProblems("replay", "/tmp/out.json", ["a is bad", "b is bad"]);
    expect(msg).toMatch(/\[replay\] generated payload at \/tmp\/out\.json failed/);
    expect(msg).toMatch(/2 problems/);
    expect(msg).toMatch(/  - a is bad/);
    expect(msg).toMatch(/  - b is bad/);
  });
});
