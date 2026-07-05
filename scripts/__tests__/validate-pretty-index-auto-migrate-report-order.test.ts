// --auto-migrate --report emits a JSON envelope on stdout. Field ordering
// MUST be deterministic (sort_keys=True) so cross-platform diffs of the
// report are stable. This test asserts:
//   * top-level keys are exactly ["file", "problems"] in that order
//   * per-problem keys are exactly
//     ["actual", "expected", "index", "message", "path"] in that order
//   * running the same input twice produces byte-identical stdout
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
  const d = mkdtempSync(join(tmpdir(), "auto-migrate-report-order-"));
  cleanups.push(d);
  return d;
}
function keyOrder(json: string, pointer: (o: any) => any): string[] {
  // Rely on JSON.parse preserving insertion order for string keys
  // (guaranteed for non-integer-index string keys in ES2020+).
  return Object.keys(pointer(JSON.parse(json)));
}
function run(indexPath: string) {
  return spawnSync(
    "python3",
    [VALIDATOR, "--auto-migrate", "--require-version", "1", "--report", indexPath],
    { encoding: "utf8" },
  );
}

describe("validate-pretty-index.py --auto-migrate --report field ordering", () => {
  it("passing report has [file, problems] in that order and is stable", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    writeFileSync(f, "[]"); // valid v0 -> migrates to v1, passes
    const a = run(f);
    // Reset and re-run to compare stdout byte-for-byte.
    writeFileSync(f, "[]");
    const b = run(f);
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    expect(a.stdout).toBe(b.stdout);
    expect(keyOrder(a.stdout, (o) => o)).toEqual(["file", "problems"]);
  });

  it("failing report has [file, problems] and each problem has sorted keys", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    writeFileSync(f, JSON.stringify([{ folder: "only" }]));
    const a = run(f);
    writeFileSync(f, JSON.stringify([{ folder: "only" }]));
    const b = run(f);
    expect(a.status).toBe(3);
    expect(b.status).toBe(3);
    expect(a.stdout).toBe(b.stdout);
    expect(keyOrder(a.stdout, (o) => o)).toEqual(["file", "problems"]);
    const parsed = JSON.parse(a.stdout);
    expect(parsed.problems.length).toBeGreaterThan(0);
    for (const p of parsed.problems) {
      expect(Object.keys(p)).toEqual([
        "actual",
        "expected",
        "index",
        "message",
        "path",
      ]);
    }
  });
});
