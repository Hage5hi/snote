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
