// Unit tests for scripts/ci-vitest-failure-summary.ts.
//
// We feed the parser synthetic reporter outputs that mimic the shapes
// vitest emits across versions / verbosity levels / platforms:
//
//   1. Default reporter (one-liner `FAIL path > suite > name`)
//   2. Verbose reporter (`× path > suite > name 12ms`)
//   3. Two-line form (`❯ path` header then indented `× test 12ms` rows)
//   4. Unicode markers (`✖`, `✗`)
//   5. CRLF logs (Windows runners) — must still parse cleanly
//
// Each case asserts the parsed (suite, test) pairs + that the rendered
// markdown / JSON outputs include the expected suite + test names. We
// avoid byte-for-byte snapshots so adding context lines to the renderer
// later doesn't churn this file.
import { describe, expect, it } from "vitest";
import {
  FAILURE_BREAKDOWN_SCHEMA_VERSION,
  parseVitestLog,
  renderJson,
  renderMarkdown,
} from "../ci-vitest-failure-summary";

describe("ci-vitest-failure-summary parser", () => {
  it("parses default one-liner FAIL rows", () => {
    const log = [
      " FAIL  scripts/__tests__/a.test.ts > suite A > test one",
      "    AssertionError: expected 1 to be 2",
      "    - 1",
      "    + 2",
      "",
      " Test Files  1 failed",
    ].join("\n");
    const f = parseVitestLog(log);
    expect(f).toHaveLength(1);
    expect(f[0].file).toBe("scripts/__tests__/a.test.ts");
    expect(f[0].test).toBe("suite A > test one");
    expect(f[0].diff.join("\n")).toContain("expected 1 to be 2");
  });

  it("parses verbose reporter rows with trailing duration", () => {
    const log = [
      " × scripts/__tests__/b.spec.tsx > group > does the thing 42ms",
      "    Error: nope",
      "",
      " Tests  1 failed | 5 passed",
    ].join("\n");
    const f = parseVitestLog(log);
    expect(f).toHaveLength(1);
    expect(f[0].file).toBe("scripts/__tests__/b.spec.tsx");
    expect(f[0].test).toBe("group > does the thing");
  });

  it("parses two-line form (❯ header + indented × test rows)", () => {
    const log = [
      " ❯ scripts/__tests__/c.test.ts (2 tests | 2 failed)",
      "   × first failing test 11ms",
      "     AssertionError: a",
      "   × second failing test 7ms",
      "     AssertionError: b",
      "",
      " Test Files  1 failed",
    ].join("\n");
    const f = parseVitestLog(log);
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.test)).toEqual([
      "first failing test",
      "second failing test",
    ]);
    expect(f.every((x) => x.file === "scripts/__tests__/c.test.ts")).toBe(true);
    expect(f[0].diff.join("\n")).toContain("AssertionError: a");
    expect(f[1].diff.join("\n")).toContain("AssertionError: b");
  });

  it("parses Unicode failure markers (✖ and ✗)", () => {
    const log = [
      " ✖ scripts/__tests__/d.test.ts > x > y",
      "    Error: marker ✖",
      " ✗ scripts/__tests__/d.test.ts > x > z",
      "    Error: marker ✗",
      "",
      " Tests  2 failed",
    ].join("\n");
    const f = parseVitestLog(log);
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.test)).toEqual(["x > y", "x > z"]);
  });

  it("parses CRLF logs (Windows captured stdout)", () => {
    const log =
      " FAIL  scripts/__tests__/e.test.ts > win > thing\r\n" +
      "    Error: crlf land\r\n" +
      "\r\n" +
      " Test Files  1 failed\r\n";
    const f = parseVitestLog(log);
    expect(f).toHaveLength(1);
    expect(f[0].file).toBe("scripts/__tests__/e.test.ts");
    expect(f[0].test).toBe("win > thing");
    expect(f[0].diff.join("\n")).toContain("crlf land");
  });

  it("strips ANSI colour codes so coloured CI logs still match", () => {
    const log = [
      "\x1b[31m FAIL \x1b[0m \x1b[1mscripts/__tests__/f.test.ts > red > blue\x1b[0m",
      "\x1b[31m   AssertionError: nope\x1b[0m",
    ].join("\n");
    const f = parseVitestLog(log);
    expect(f).toHaveLength(1);
    expect(f[0].test).toBe("red > blue");
  });

  it("returns no failures for a clean log and renders the empty marker", () => {
    const log = [
      " ✓ scripts/__tests__/g.test.ts (3)",
      " Test Files  1 passed (1)",
      " Tests  3 passed (3)",
    ].join("\n");
    const f = parseVitestLog(log);
    expect(f).toHaveLength(0);
    expect(renderMarkdown(f)).toMatch(/No failing tests/i);
    const json = JSON.parse(renderJson(f));
    expect(json).toEqual({ failureCount: 0, suiteCount: 0, failures: [] });
  });

  it("renders markdown grouped by suite with diff fences", () => {
    const log = [
      " FAIL  scripts/__tests__/h.test.ts > a > one",
      "    Error: 1",
      " FAIL  scripts/__tests__/h.test.ts > a > two",
      "    Error: 2",
      " FAIL  scripts/__tests__/i.test.ts > b > three",
      "    Error: 3",
      "",
      " Test Files  2 failed",
    ].join("\n");
    const md = renderMarkdown(parseVitestLog(log));
    expect(md).toContain("3 failing tests across 2 suites");
    expect(md).toContain("### `scripts/__tests__/h.test.ts`");
    expect(md).toContain("### `scripts/__tests__/i.test.ts`");
    expect(md).toContain("```diff");
  });

  it("renders machine-readable JSON with suite/test/diff", () => {
    const log = [
      " FAIL  scripts/__tests__/j.test.ts > z > one",
      "    Error: boom",
      "",
      " Test Files  1 failed",
    ].join("\n");
    const obj = JSON.parse(renderJson(parseVitestLog(log)));
    expect(obj.failureCount).toBe(1);
    expect(obj.suiteCount).toBe(1);
    expect(obj.failures[0]).toMatchObject({
      suite: "scripts/__tests__/j.test.ts",
      test: "z > one",
    });
    expect(obj.failures[0].diff).toContain("boom");
  });
});
