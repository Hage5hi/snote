// Property-based / fuzz tests for scripts/validate-pretty-index.py.
//
// Goals:
//   1. No random payload — no matter how malformed — makes the validator
//      crash (i.e. exit with a code outside the documented set).
//   2. Exit codes are stable and match the documented contract:
//        0 (valid), 3 (schema fail), 6 (parse / bad envelope).
//        (2 is usage-only and 4 is "file missing", neither can happen
//        here because we always pass a real file with a payload.)
//   3. Error stderr is deterministic in shape: it always starts with the
//      "validate-pretty-index:" prefix on failure, never contains a
//      Python traceback.
//   4. When --report is passed, stdout is either empty (unreachable
//      because we always pass a file) or valid JSON with the documented
//      {"file", "problems"} shape.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const VALIDATOR = resolve(__dirname, "..", "validate-pretty-index.py");

function run(payload: string, extraArgs: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "pi-fuzz-"));
  const p = join(dir, "pretty-index.json");
  writeFileSync(p, payload);
  try {
    const stdout = execFileSync(
      "python3",
      [VALIDATOR, ...extraArgs, p],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return {
      code: e.status ?? -1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

// Deterministic PRNG so failures reproduce.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = [
  "folder", "summary_file", "pretty_txt", "pretty_md",
  "fail_reason", "exit_code", "pretty_status", "pretty_exit_code",
  "extra_key",
];
function randomValue(rand: () => number): unknown {
  const bucket = Math.floor(rand() * 7);
  switch (bucket) {
    case 0: return null;
    case 1: return Math.floor(rand() * 1000) - 500;
    case 2: return rand() > 0.5;
    case 3: return "s".repeat(Math.floor(rand() * 20));
    case 4: return [];
    case 5: return {};
    default: return rand();
  }
}
function randomEntry(rand: () => number): unknown {
  if (rand() < 0.1) return randomValue(rand);
  const obj: Record<string, unknown> = {};
  const n = Math.floor(rand() * KEYS.length);
  for (let i = 0; i < n; i++) obj[KEYS[Math.floor(rand() * KEYS.length)]] = randomValue(rand);
  return obj;
}
function randomPayload(rand: () => number): string {
  const shape = Math.floor(rand() * 6);
  if (shape === 0) return "not-json-at-all-{{";
  if (shape === 1) return JSON.stringify(randomValue(rand));
  if (shape === 2) {
    const arr = Array.from({ length: Math.floor(rand() * 4) }, () => randomEntry(rand));
    return JSON.stringify(arr);
  }
  if (shape === 3) return JSON.stringify({ schema_version: Math.floor(rand() * 200) - 50, entries: [] });
  if (shape === 4) return JSON.stringify({ schema_version: rand() > 0.5 ? "1" : null, entries: [] });
  const entries = Array.from({ length: Math.floor(rand() * 4) }, () => randomEntry(rand));
  return JSON.stringify({ schema_version: 1, entries });
}

const ALLOWED_CODES = new Set([0, 3, 6]);

describe("validate-pretty-index.py fuzz", () => {
  it("never crashes; exit codes stay in the documented set", () => {
    const rand = mulberry32(0xC0FFEE);
    for (let i = 0; i < 60; i++) {
      const payload = randomPayload(rand);
      const { code, stderr } = run(payload);
      expect(ALLOWED_CODES.has(code), `unexpected code=${code} for payload=${payload}`).toBe(true);
      // Never a Python traceback on stderr.
      expect(stderr).not.toMatch(/Traceback \(most recent call last\)/);
      if (code !== 0) {
        // Errors always carry the documented prefix.
        expect(stderr).toMatch(/^validate-pretty-index:/);
      }
    }
  }, 30_000);

  it("--report always emits valid JSON with the documented shape", () => {
    const rand = mulberry32(0xBADF00D);
    for (let i = 0; i < 40; i++) {
      const payload = randomPayload(rand);
      const { code, stdout } = run(payload, ["--report"]);
      if (code === 6) {
        // Parse errors happen before --report can emit anything.
        expect(stdout).toBe("");
        continue;
      }
      expect(() => JSON.parse(stdout), `not JSON: ${stdout.slice(0, 200)}`).not.toThrow();
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty("file");
      expect(parsed).toHaveProperty("problems");
      expect(Array.isArray(parsed.problems)).toBe(true);
      for (const prob of parsed.problems) {
        // Field ordering is enforced by sort_keys=True; every problem
        // must carry these keys with these types.
        expect(prob).toHaveProperty("actual");
        expect(prob).toHaveProperty("expected");
        expect(prob).toHaveProperty("message");
        expect(prob).toHaveProperty("path");
      }
    }
  });
});
