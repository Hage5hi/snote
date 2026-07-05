// Unit tests for scripts/check-pretty-index-schema-version.py.
//
// The self-check compares the file's schema_version against
// validate-pretty-index.py's CURRENT_SCHEMA_VERSION and prints a
// regeneration hint to $GITHUB_STEP_SUMMARY on mismatch.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const CHECK = join(REPO, "scripts", "check-pretty-index-schema-version.py");

const cleanups: string[] = [];
afterEach(() => {
  for (const d of cleanups.splice(0)) spawnSync("rm", ["-rf", d]);
});

function workdir(): string {
  const d = mkdtempSync(join(tmpdir(), "check-pretty-index-"));
  cleanups.push(d);
  return d;
}

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync("python3", [CHECK, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("check-pretty-index-schema-version.py", () => {
  it("exit 2 on usage error", () => {
    expect(run([]).status).toBe(2);
  });

  it("exit 4 when the file is missing", () => {
    const d = workdir();
    const r = run([join(d, "nope.json")]);
    expect(r.status).toBe(4);
  });

  it("exit 0 when the generator emits the current schema_version", () => {
    const d = workdir();
    const f = join(d, "index.json");
    writeFileSync(f, JSON.stringify({ schema_version: 1, entries: [] }));
    const r = run([f]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/OK/);
  });

  it("exit 1 with ::error:: and step-summary hint on drift (v0 vs current)", () => {
    const d = workdir();
    const f = join(d, "index.json");
    const summary = join(d, "step-summary.md");
    writeFileSync(f, JSON.stringify([])); // legacy v0 array
    writeFileSync(summary, "");

    const r = run([f], { GITHUB_STEP_SUMMARY: summary });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("::error");
    expect(r.stderr).toMatch(/schema drift/);
    const body = readFileSync(summary, "utf8");
    expect(body).toContain("pretty-index.json schema drift");
    expect(body).toContain("scripts/migrate-pretty-index.py");
  });
});
