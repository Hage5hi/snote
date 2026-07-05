// Fuzz test for scripts/migrate-pretty-index.py.
//
// Property: whenever migrate exits 0 for a legacy v0 (bare array) input,
// the output file MUST be a valid v1 envelope in shape:
//   {"schema_version": 1, "entries": [<same items>]}
// Regardless of how malformed the individual array items are, the
// migrator must never invent, drop, or reorder items, and must never
// emit non-JSON output or a non-envelope shape.
//
// The migrator's job is envelope-only; per-entry validation is the
// validator's responsibility. This test only asserts the envelope
// invariants and that the migrator never crashes.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATE = resolve(__dirname, "..", "migrate-pretty-index.py");

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

function randomItem(rand: () => number): unknown {
  const bucket = Math.floor(rand() * 8);
  switch (bucket) {
    case 0: return null;
    case 1: return Math.floor(rand() * 1000);
    case 2: return rand() > 0.5;
    case 3: return "s".repeat(Math.floor(rand() * 12));
    case 4: return [randomLeaf(rand), randomLeaf(rand)];
    case 5: return { k: randomLeaf(rand) };
    case 6: return {};
    default: return { folder: "x", exit_code: "not-an-int" };
  }
}
function randomLeaf(rand: () => number): unknown {
  const b = Math.floor(rand() * 4);
  if (b === 0) return null;
  if (b === 1) return "s";
  if (b === 2) return 1;
  return true;
}
function randomV0Array(rand: () => number): unknown[] {
  const n = Math.floor(rand() * 6);
  return Array.from({ length: n }, () => randomItem(rand));
}

const ALLOWED = new Set([0, 2, 4, 6]);

describe("migrate-pretty-index.py fuzz (v0 -> v1 envelope invariants)", () => {
  it("never emits an invalid v1 envelope for random v0 inputs", () => {
    const rand = mulberry32(0xFACADE);
    for (let i = 0; i < 60; i++) {
      const items = randomV0Array(rand);
      const dir = mkdtempSync(join(tmpdir(), "migrate-fuzz-"));
      const src = join(dir, "in.json");
      const dst = join(dir, "out.json");
      writeFileSync(src, JSON.stringify(items));

      const r = spawnSync(
        "python3",
        [MIGRATE, src, "--output", dst],
        { encoding: "utf8" },
      );
      try {
        expect(
          ALLOWED.has(r.status ?? -1),
          `unexpected exit=${r.status} stderr=${r.stderr}`,
        ).toBe(true);
        // Never a Python traceback.
        expect(r.stderr).not.toMatch(/Traceback \(most recent call last\)/);

        if (r.status !== 0) continue;

        const raw = readFileSync(dst, "utf8");
        // Must be JSON.
        const parsed = JSON.parse(raw);
        // Envelope invariants: object, schema_version === 1, entries array.
        expect(parsed).toBeTypeOf("object");
        expect(Array.isArray(parsed)).toBe(false);
        expect(parsed.schema_version).toBe(1);
        expect(Array.isArray(parsed.entries)).toBe(true);
        // Items are preserved exactly (count + content).
        expect(parsed.entries).toEqual(items);
      } finally {
        spawnSync("rm", ["-rf", dir]);
      }
    }
  }, 60_000);
});
