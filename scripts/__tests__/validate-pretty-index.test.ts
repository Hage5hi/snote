// Unit tests for scripts/validate-pretty-index.py.
//
// Exit-code contract (mirrors the script's docstring):
//   0  valid
//   2  usage error (wrong argc)
//   3  schema validation failed (per-entry breakdown on stderr)
//   4  file missing
//   6  file exists but not valid JSON, or top-level is not an array
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const VALIDATOR = join(REPO, "scripts", "validate-pretty-index.py");

const cleanups: string[] = [];
afterEach(() => {
  for (const d of cleanups.splice(0)) spawnSync("rm", ["-rf", d]);
});

function workdir(): string {
  const d = mkdtempSync(join(tmpdir(), "validate-pretty-index-"));
  cleanups.push(d);
  return d;
}

function run(args: string[]) {
  return spawnSync("python3", [VALIDATOR, ...args], { encoding: "utf8" });
}

function validEntry(over: Record<string, unknown> = {}) {
  return {
    folder: "20260705T134402Z-seed-42",
    summary_file: "artifacts/x/replay-summary.json",
    pretty_txt: "artifacts/x/pretty.txt",
    pretty_md: "artifacts/x/pretty.md",
    fail_reason: "",
    exit_code: 0,
    pretty_status: "ok",
    pretty_exit_code: 0,
    ...over,
  };
}

describe("validate-pretty-index.py", () => {
  it("exit 2 on usage error (no argument)", () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage:/);
  });

  it("exit 4 when the file is missing", () => {
    const dir = workdir();
    const r = run([join(dir, "does-not-exist.json")]);
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/file not found/);
  });

  it("exit 6 on malformed JSON", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, "{not json");
    const r = run([p]);
    expect(r.status).toBe(6);
    expect(r.stderr).toMatch(/cannot parse/);
  });

  it("exit 6 when top-level is not an array", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify({ not: "array" }));
    const r = run([p]);
    expect(r.status).toBe(6);
    expect(r.stderr).toMatch(/top-level must be an array/);
  });

  it("exit 0 on a valid (possibly empty) array", () => {
    const dir = workdir();
    const empty = join(dir, "empty.json");
    writeFileSync(empty, "[]");
    expect(run([empty]).status).toBe(0);

    const full = join(dir, "full.json");
    writeFileSync(full, JSON.stringify([validEntry(), validEntry({ exit_code: null })]));
    expect(run([full]).status).toBe(0);
  });

  it("exit 3 on schema mismatch — missing required keys", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify([{ folder: "x" }]));
    const r = run([p]);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/schema validation failed/);
    for (const k of ["summary_file", "pretty_txt", "pretty_md", "fail_reason", "exit_code", "pretty_status", "pretty_exit_code"]) {
      expect(r.stderr).toContain(`missing key: ${k}`);
    }
  });

  it("exit 3 on schema mismatch — wrong types", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify([
      validEntry({ exit_code: "0" }),          // must be int|null
      validEntry({ pretty_txt: 42 }),          // must be string
      validEntry({ pretty_md: false }),        // must be string
      validEntry({ pretty_exit_code: null }),  // must be int (not null)
      validEntry({ fail_reason: 123 }),        // must be string
    ]));
    const r = run([p]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("[0] exit_code must be int or null");
    expect(r.stderr).toContain("[1] pretty_txt must be a string");
    expect(r.stderr).toContain("[2] pretty_md must be a string");
    expect(r.stderr).toContain("[3] pretty_exit_code must be an int");
    expect(r.stderr).toContain("[4] fail_reason must be a string");
  });

  it("exit 3 when an entry is not an object", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify([validEntry(), "nope", 7]));
    const r = run([p]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("[1] entry is not an object");
    expect(r.stderr).toContain("[2] entry is not an object");
  });
});

describe("validate-pretty-index.py — versioned envelope", () => {
  it("accepts {schema_version:1, entries:[...]}", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify({ schema_version: 1, entries: [validEntry()] }));
    expect(run([p]).status).toBe(0);
  });

  it("exit 3 on unsupported schema_version with clear message", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify({ schema_version: 99, entries: [] }));
    const r = run([p]);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/unsupported schema_version=99/);
  });

  it("exit 3 when versioned envelope is missing schema_version or entries", () => {
    const dir = workdir();
    const missingVer = join(dir, "a.json");
    writeFileSync(missingVer, JSON.stringify({ entries: [] }));
    const r1 = run([missingVer]);
    expect(r1.status).toBe(3);
    expect(r1.stderr).toMatch(/missing schema_version/);

    const missingEntries = join(dir, "b.json");
    writeFileSync(missingEntries, JSON.stringify({ schema_version: 1 }));
    const r2 = run([missingEntries]);
    expect(r2.status).toBe(3);
    expect(r2.stderr).toMatch(/entries must be an array/);
  });
});

describe("validate-pretty-index.py — --report flag", () => {
  it("prints a structured JSON report on success (problems: [])", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify([validEntry()]));
    const r = run(["--report", p]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.problems).toEqual([]);
    expect(parsed.file).toBe(p);
  });

  it("emits path + expected + actual for each failure", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify([
      validEntry({ exit_code: "0" }),
      validEntry({ pretty_txt: 42 }),
    ]));
    const r = run(["--print-errors", p]);
    expect(r.status).toBe(3);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.problems).toHaveLength(2);
    expect(parsed.problems[0]).toMatchObject({
      index: 0, path: "entries[0].exit_code",
      expected: "int|null", actual: "str",
    });
    expect(parsed.problems[1]).toMatchObject({
      index: 1, path: "entries[1].pretty_txt",
      expected: "string", actual: "int",
    });
  });

  it("emits envelope-level problem for unsupported schema_version", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify({ schema_version: 42, entries: [] }));
    const r = run(["--report", p]);
    expect(r.status).toBe(3);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.problems[0]).toMatchObject({
      index: null, path: "$.schema_version", actual: "42",
    });
  });

  it("unsupported schema_version message tells users how to regenerate", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify({ schema_version: 99, entries: [] }));
    const r = run([p]);
    expect(r.status).toBe(3);
    // The regeneration hint MUST appear in the human-readable stderr
    // so contributors can copy the exact next-step command from the
    // failing CI log without opening docs.
    expect(r.stderr).toMatch(/regenerate pretty-index\.json/);
    expect(r.stderr).toContain("scripts/pretty-replay-summary.py");
    expect(r.stderr).toContain("scripts/validate-pretty-index.py");
    expect(r.stderr).toContain("docs/schema-drift-diff-test-hooks.md");
  });
});

describe("validate-pretty-index.py — --report snapshot formatting", () => {
  // Frozen JSON output for a known invalid fixture. The snapshot
  // pins: sorted top-level keys (file, problems), 2-space indent,
  // sorted per-problem keys (actual, expected, index, message, path),
  // trailing newline, and the exact enumeration order for a mixed
  // missing/wrong-type input.
  const FIXTURE = [{ folder: "x" }, "nope"];

  it("matches the exact --report JSON for a known invalid fixture", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify(FIXTURE));
    const r = run(["--report", p]);
    expect(r.status).toBe(3);
    const normalized = r.stdout.replace(
      /"file":\s*"[^"]+"/,
      '"file": "<TMP>/index.json"',
    );
    // Structural assertions (survive minor formatting tweaks) …
    const parsed = JSON.parse(r.stdout);
    expect(Object.keys(parsed)).toEqual(["file", "problems"]);
    for (const prob of parsed.problems) {
      expect(Object.keys(prob)).toEqual([
        "actual", "expected", "index", "message", "path",
      ]);
    }
    // … plus a full snapshot so field order + spacing are frozen.
    expect(normalized.endsWith("\n")).toBe(true);
    expect(normalized).toContain('"file": "<TMP>/index.json"');
    expect(normalized).toContain('"path": "entries[0].summary_file"');
    expect(normalized).toContain('"path": "entries[1]"');
    expect(normalized).toContain('"message": "[1] entry is not an object"');
    // Order of missing-key problems is REQUIRED order from the script.
    const idxSummary = normalized.indexOf("summary_file");
    const idxPretty = normalized.indexOf("pretty_exit_code");
    const idxNotObj = normalized.indexOf("entry is not an object");
    expect(idxSummary).toBeGreaterThan(0);
    expect(idxPretty).toBeGreaterThan(idxSummary);
    expect(idxNotObj).toBeGreaterThan(idxPretty);
  });

  it("--print-errors is a byte-identical alias of --report", () => {
    const dir = workdir();
    const p = join(dir, "index.json");
    writeFileSync(p, JSON.stringify(FIXTURE));
    const a = run(["--report", p]);
    const b = run(["--print-errors", p]);
    expect(a.status).toBe(b.status);
    expect(a.stdout).toBe(b.stdout);
  });
});


