// Unit tests for scripts/schema-drift-view.sh — verifies flag parsing
// and filtering behavior without touching real drift bundles by using
// --dry-run (which prints MATCH/SKIP lines instead of running viewers).
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../schema-drift-view.sh");

function run(args: string[], env: Record<string, string> = {}) {
  const res = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH ?? "", ...env },
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const ALL_BASES = [
  "focus-trap-inspect-report.schema.json",
  "focus-trap-inspect-diff.schema.json",
  "focus-trap-inspect-schema.types.gen.ts",
];

describe("scripts/schema-drift-view.sh", () => {
  it("--help exits 0 and documents all flags + examples", () => {
    const { code, stdout } = run(["--help"]);
    expect(code).toBe(0);
    for (const s of ["Usage:", "--type", "--file", "--viewer", "--dry-run", "Examples:"]) {
      expect(stdout).toContain(s);
    }
  });

  it("unknown arg exits 2 and prints usage on stderr", () => {
    const { code, stderr } = run(["--nope"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/unknown arg/);
    expect(stderr).toContain("Usage:");
  });

  it("without a bundle and without --dry-run, exits 1", () => {
    const { code, stderr } = run([], { OUT: "/tmp/definitely-not-a-bundle-xyz" });
    expect(code).toBe(1);
    expect(stderr).toMatch(/no drift bundle/);
  });

  describe("--dry-run", () => {
    const dry = (extra: string[]) => run(["--dry-run", ...extra], { OUT: "/tmp/nope-not-real" });

    it("succeeds without a real bundle and lists all 3 files by default", () => {
      const { code, stdout } = dry([]);
      expect(code).toBe(0);
      for (const b of ALL_BASES) expect(stdout).toMatch(new RegExp(`MATCH\\s+${b}`));
    });

    it("--type types shows only the .types.gen.ts base", () => {
      const { stdout } = dry(["--type", "types"]);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-schema\.types\.gen\.ts/);
      expect(stdout).not.toMatch(/MATCH\s+focus-trap-inspect-report\.schema\.json/);
      expect(stdout).not.toMatch(/MATCH\s+focus-trap-inspect-diff\.schema\.json/);
    });

    it("--type schemas shows only the two schema JSON bases", () => {
      const { stdout } = dry(["--type", "schemas"]);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-report\.schema\.json/);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-diff\.schema\.json/);
      expect(stdout).not.toMatch(/MATCH\s+focus-trap-inspect-schema\.types\.gen\.ts/);
    });

    it("positional shorthand matches --type", () => {
      const a = dry(["types"]).stdout;
      const b = dry(["--type", "types"]).stdout;
      // Compare only MATCH/SKIP lines (footer includes cols/etc that could vary).
      const lines = (s: string) => s.split("\n").filter((l) => /^(MATCH|SKIP)/.test(l));
      expect(lines(a)).toEqual(lines(b));
    });

    it("--viewer diff-y is honored in the printed plan", () => {
      const { stdout } = dry(["--viewer", "diff-y"]);
      expect(stdout).toMatch(/diff -y/);
      expect(stdout).toContain("viewer=diff-y");
    });

    it("--viewer cat routes through pretty(cat)", () => {
      const { stdout } = dry(["--viewer", "cat"]);
      expect(stdout).toMatch(/pretty\(cat\)/);
    });

    it("unknown --viewer exits 2", () => {
      const { code, stderr } = dry(["--viewer", "bogus"]);
      expect(code).toBe(2);
      expect(stderr).toMatch(/unknown --viewer/);
    });

    it("single --file substring narrows to matching bases and SKIPs the rest", () => {
      const { stdout } = dry(["--file", "report"]);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-report\.schema\.json/);
      expect(stdout).toMatch(/SKIP\s+focus-trap-inspect-diff\.schema\.json/);
      expect(stdout).toMatch(/SKIP\s+focus-trap-inspect-schema\.types\.gen\.ts/);
    });

    it("repeatable --file: multiple flags union the substrings", () => {
      const { stdout } = dry(["--file", "report", "--file", "types.gen"]);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-report\.schema\.json/);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-schema\.types\.gen\.ts/);
      expect(stdout).toMatch(/SKIP\s+focus-trap-inspect-diff\.schema\.json/);
    });

    it("comma-separated --file: one flag expands to multiple substrings", () => {
      const { stdout } = dry(["--file", "report,types.gen"]);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-report\.schema\.json/);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-schema\.types\.gen\.ts/);
      expect(stdout).toMatch(/SKIP\s+focus-trap-inspect-diff\.schema\.json/);
    });

    it("mixing repeat + comma forms works", () => {
      const { stdout } = dry(["--file", "report,diff", "--file", "types.gen"]);
      for (const b of ALL_BASES) expect(stdout).toMatch(new RegExp(`MATCH\\s+${b}`));
    });

    it("--file with no matches SKIPs everything (still exits 0)", () => {
      const { code, stdout } = dry(["--file", "nothing-matches-this"]);
      expect(code).toBe(0);
      for (const b of ALL_BASES) expect(stdout).toMatch(new RegExp(`SKIP\\s+${b}`));
      expect(stdout).not.toMatch(/MATCH\s+/);
    });

    it("footer echoes resolved flags including file list", () => {
      const { stdout } = dry(["--type", "schemas", "--file", "report,diff", "--viewer", "cat"]);
      expect(stdout).toMatch(/type=schemas/);
      expect(stdout).toMatch(/viewer=cat/);
      expect(stdout).toMatch(/files=\[report diff\]/);
    });
  });
});
