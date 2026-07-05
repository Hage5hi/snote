// Matrix: assert stable exit codes for each validate-pretty-index.py
// failure mode. These codes are part of the CI/local contract documented
// in docs/schema-drift-diff-test-hooks.md and consumed by
// scripts/check-pretty-index-local.sh.
//
//   0 valid
//   2 usage error
//   3 schema validation failed (per-entry OR envelope)
//   4 file missing
//   6 not JSON / unrecognized top-level shape
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const VALIDATOR = resolve(__dirname, "..", "validate-pretty-index.py");
const cleanups: string[] = [];
afterEach(() => {
  for (const d of cleanups.splice(0)) spawnSync("rm", ["-rf", d]);
});
function workdir() {
  const d = mkdtempSync(join(tmpdir(), "exit-code-matrix-"));
  cleanups.push(d);
  return d;
}
function write(name: string, body: string): string {
  const d = workdir();
  const f = join(d, name);
  writeFileSync(f, body);
  return f;
}
function run(args: string[]) {
  return spawnSync("python3", [VALIDATOR, ...args], { encoding: "utf8" });
}

interface Case {
  name: string;
  args: () => string[];
  code: number;
  stderrMatch?: RegExp;
}

const cases: Case[] = [
  {
    name: "usage: no args -> 2",
    args: () => [],
    code: 2,
    stderrMatch: /usage:/,
  },
  {
    name: "usage: --require-version without value -> 2",
    args: () => ["--require-version"],
    code: 2,
  },
  {
    name: "usage: --auto-migrate without --require-version -> 2",
    args: () => ["--auto-migrate", write("f.json", "[]")],
    code: 2,
    stderrMatch: /--auto-migrate requires --require-version/,
  },
  {
    name: "missing file -> 4",
    args: () => [join(workdir(), "nope.json")],
    code: 4,
    stderrMatch: /file not found/,
  },
  {
    name: "invalid JSON -> 6",
    args: () => [write("f.json", "not json{")],
    code: 6,
    stderrMatch: /cannot parse/,
  },
  {
    name: "unrecognized top-level shape (string) -> 6",
    args: () => [write("f.json", '"just a string"')],
    code: 6,
    stderrMatch: /top-level must be an array/,
  },
  {
    name: "unrecognized top-level shape (bare object) -> 6",
    args: () => [write("f.json", '{"unrelated": true}')],
    code: 6,
  },
  {
    name: "envelope: schema_version wrong type -> 3",
    args: () => [write("f.json", '{"schema_version":"bad","entries":[]}')],
    code: 3,
    stderrMatch: /schema_version must be an int/,
  },
  {
    name: "envelope: unsupported schema_version -> 3",
    args: () => [write("f.json", '{"schema_version":99,"entries":[]}')],
    code: 3,
    stderrMatch: /unsupported schema_version=99/,
  },
  {
    name: "envelope: entries wrong type -> 3",
    args: () => [write("f.json", '{"schema_version":1,"entries":"x"}')],
    code: 3,
    stderrMatch: /entries must be an array/,
  },
  {
    name: "per-entry: missing keys -> 3",
    args: () => [write("f.json", '[{"folder":"x"}]')],
    code: 3,
    stderrMatch: /missing key: summary_file/,
  },
  {
    name: "--require-version drift (bare v0 vs required 1) -> 3",
    args: () => [
      "--require-version",
      "1",
      write("f.json", "[]"),
    ],
    code: 3,
    stderrMatch: /does not match required version=1/,
  },
  {
    name: "valid v1 empty envelope -> 0",
    args: () => [write("f.json", '{"schema_version":1,"entries":[]}')],
    code: 0,
  },
  {
    name: "valid legacy v0 empty array -> 0",
    args: () => [write("f.json", "[]")],
    code: 0,
  },
];

describe("validate-pretty-index.py exit-code matrix", () => {
  it.each(cases)("$name", ({ args, code, stderrMatch }) => {
    const r = run(args());
    expect(r.status).toBe(code);
    if (stderrMatch) expect(r.stderr).toMatch(stderrMatch);
  });
});
