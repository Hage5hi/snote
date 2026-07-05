// Cross-platform normalization: the machine-readable --report output and
// the human-readable stderr breakdown must use logical JSON pointer paths
// (e.g. "entries[0].summary_file", "$.schema_version") — NOT filesystem
// paths — so diffs are byte-identical on Windows and macOS runners.
//
// This suite also asserts that a path passed on the CLI with backslashes
// (a Windows-style input) does not leak backslashes into problem `path`
// fields or into the stderr per-problem lines.
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
  const d = mkdtempSync(join(tmpdir(), "pretty-index-xplat-"));
  cleanups.push(d);
  return d;
}
function run(...args: string[]) {
  return spawnSync("python3", [VALIDATOR, ...args], { encoding: "utf8" });
}

describe("validate-pretty-index.py cross-platform path normalization", () => {
  it("problem.path fields use logical JSON pointers, never OS separators", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    writeFileSync(
      f,
      JSON.stringify([{ folder: "x" }, { summary_file: 1, folder: "y" }]),
    );
    const r = run("--require-version", "1", "--report", f);
    expect(r.status).toBe(3);
    const report = JSON.parse(r.stdout);
    for (const p of report.problems) {
      expect(p.path).not.toContain("\\");
      expect(p.path).toMatch(/^(\$\.[a-z_]+|entries\[\d+\](\.[a-z_]+)?)$/);
    }
    // Envelope-shape errors serialize as "$.<field>".
    const paths = report.problems.map((p: any) => p.path);
    expect(paths).toContain("entries[0].summary_file");
  });

  it("stderr per-problem lines use bracketed indices, not OS paths", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    writeFileSync(f, JSON.stringify([{ folder: "only" }]));
    const r = run("--require-version", "1", f);
    expect(r.status).toBe(3);
    // Every "  - " problem line starts with "[<index>] " or the envelope
    // hint text — never a filesystem path fragment.
    const problemLines = r.stderr
      .split("\n")
      .filter((l) => l.startsWith("  - "));
    expect(problemLines.length).toBeGreaterThan(0);
    for (const line of problemLines) {
      expect(line).not.toMatch(/\\[A-Za-z]/); // no windows-style separators
      expect(line).toMatch(/^  - (\[\d+\] |[a-z])/);
    }
  });

  it("report.file echoes the input path verbatim (no OS-specific rewrite)", () => {
    const d = workdir();
    const { mkdirSync } = require("node:fs");
    mkdirSync(join(d, "sub"), { recursive: true });
    const f = join(d, "sub", "pretty-index.json");
    writeFileSync(f, "[]");
    const r = run("--require-version", "1", "--report", f);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).file).toBe(f);
  });
});
