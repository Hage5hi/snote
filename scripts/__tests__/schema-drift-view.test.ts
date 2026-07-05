// Unit tests for scripts/schema-drift-view.sh — verifies flag parsing
// and filtering behavior without touching real drift bundles by using
// --dry-run (which prints MATCH/SKIP lines instead of running viewers).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

  describe("--exclude", () => {
    const dry = (extra: string[]) => run(["--dry-run", ...extra], { OUT: "/tmp/nope-not-real" });

    it("single --exclude drops matching bases", () => {
      const { stdout } = dry(["--exclude", "diff"]);
      expect(stdout).toMatch(/SKIP\s+focus-trap-inspect-diff\.schema\.json/);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-report\.schema\.json/);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-schema\.types\.gen\.ts/);
    });

    it("repeatable --exclude unions substrings", () => {
      const { stdout } = dry(["--exclude", "diff", "--exclude", "types.gen"]);
      expect(stdout).toMatch(/SKIP\s+focus-trap-inspect-diff\.schema\.json/);
      expect(stdout).toMatch(/SKIP\s+focus-trap-inspect-schema\.types\.gen\.ts/);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-report\.schema\.json/);
    });

    it("comma-separated --exclude expands to multiple substrings", () => {
      const { stdout } = dry(["--exclude", "diff,types.gen"]);
      expect(stdout).toMatch(/SKIP\s+focus-trap-inspect-diff\.schema\.json/);
      expect(stdout).toMatch(/SKIP\s+focus-trap-inspect-schema\.types\.gen\.ts/);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-report\.schema\.json/);
    });

    it("--exclude wins over --file when both match a base", () => {
      const { stdout } = dry(["--file", "report,diff", "--exclude", "diff"]);
      expect(stdout).toMatch(/MATCH\s+focus-trap-inspect-report\.schema\.json/);
      expect(stdout).toMatch(/SKIP\s+focus-trap-inspect-diff\.schema\.json/);
    });

    it("footer echoes exclude list", () => {
      const { stdout } = dry(["--exclude", "diff,report"]);
      expect(stdout).toMatch(/exclude=\[diff report\]/);
    });
  });

  describe("--verbose", () => {
    const dry = (extra: string[]) => run(["--dry-run", "--verbose", ...extra], { OUT: "/tmp/nope-not-real" });

    it("emits [verbose] trace lines to stderr for matched files", () => {
      const { code, stderr } = dry([]);
      expect(code).toBe(0);
      expect(stderr).toMatch(/\[verbose\] match focus-trap-inspect-report\.schema\.json/);
    });

    it("emits [verbose] trace lines for skipped files", () => {
      const { stderr } = dry(["--exclude", "diff"]);
      expect(stderr).toMatch(/\[verbose\] skip focus-trap-inspect-diff\.schema\.json/);
    });

    it("footer reports verbose=1", () => {
      const { stdout } = dry([]);
      expect(stdout).toMatch(/verbose=1/);
    });
  });

  describe("manifest output", () => {
    const withDir = (extra: string[]) => {
      const dir = mkdtempSync(join(tmpdir(), "sdv-manifest-"));
      const res = run(["--dry-run", "--manifest-dir", dir, ...extra], { OUT: "/tmp/nope-not-real" });
      return { dir, ...res };
    };

    it("writes a single <prefix>-all.json when --browsers is unset", () => {
      const { code, dir } = withDir([]);
      expect(code).toBe(0);
      const files = readdirSync(dir);
      expect(files).toEqual(["schema-drift-manifest-all.json"]);
    });

    it("--manifest-prefix controls the filename prefix", () => {
      const { dir } = withDir(["--manifest-prefix", "drift"]);
      expect(readdirSync(dir)).toEqual(["drift-all.json"]);
    });

    it("writes one file per browser when --browsers is set", () => {
      const { dir } = withDir(["--browsers", "chromium,firefox"]);
      expect(readdirSync(dir).sort()).toEqual([
        "schema-drift-manifest-chromium.json",
        "schema-drift-manifest-firefox.json",
      ]);
    });

    it("--combined-manifest also emits a combined file", () => {
      const { dir } = withDir(["--browsers", "chromium,firefox", "--combined-manifest"]);
      expect(readdirSync(dir).sort()).toEqual([
        "schema-drift-manifest-chromium.json",
        "schema-drift-manifest-combined.json",
        "schema-drift-manifest-firefox.json",
      ]);
      const combined = JSON.parse(readFileSync(join(dir, "schema-drift-manifest-combined.json"), "utf8"));
      expect(combined.combined).toBe(true);
      expect(combined.browsers).toEqual(["chromium", "firefox"]);
    });

    it("manifest JSON includes viewer command, matches, excludes, expected, matched", () => {
      const { dir } = withDir([
        "--type", "schemas",
        "--file", "report",
        "--exclude", "diff",
        "--viewer", "diff-y",
      ]);
      const m = JSON.parse(readFileSync(join(dir, "schema-drift-manifest-all.json"), "utf8"));
      expect(m.viewer).toBe("diff-y");
      expect(m.resolvedViewerCommand).toMatch(/^diff -y/);
      expect(m.matches).toEqual(["report"]);
      expect(m.excludes).toEqual(["diff"]);
      expect(m.expected).toEqual([
        "focus-trap-inspect-report.schema.json",
        "focus-trap-inspect-diff.schema.json",
      ]);
      expect(m.matched).toEqual(["focus-trap-inspect-report.schema.json"]);
    });

    describe("manifest JSON schema (regression guard)", () => {
      const REQUIRED_KEYS = [
        "browser",
        "browsers",
        "combined",
        "generatedAt",
        "type",
        "viewer",
        "resolvedViewerCommand",
        "matches",
        "excludes",
        "expected",
        "matched",
        "requiredArtifacts",
      ] as const;

      const assertShape = (m: Record<string, unknown>) => {
        for (const k of REQUIRED_KEYS) expect(m, `missing key: ${k}`).toHaveProperty(k);
        expect(typeof m.browser).toBe("string");
        expect(Array.isArray(m.browsers)).toBe(true);
        expect(typeof m.combined).toBe("boolean");
        expect(m.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        expect(["all", "types", "schemas"]).toContain(m.type as string);
        expect(["auto", "diff-y", "delta", "bat", "cat"]).toContain(m.viewer as string);
        expect(typeof m.resolvedViewerCommand).toBe("string");
        expect((m.resolvedViewerCommand as string).length).toBeGreaterThan(0);
        for (const arrKey of ["matches", "excludes", "expected", "matched"] as const) {
          expect(Array.isArray(m[arrKey])).toBe(true);
          for (const v of m[arrKey] as unknown[]) expect(typeof v).toBe("string");
        }
      };

      it("per-browser manifest has all required keys with correct types", () => {
        const { dir } = withDir(["--browsers", "chromium,firefox"]);
        for (const f of readdirSync(dir)) {
          const m = JSON.parse(readFileSync(join(dir, f), "utf8"));
          assertShape(m);
          expect(m.combined).toBe(false);
          expect(m.browsers).toHaveLength(1);
        }
      });

      it("combined manifest has combined=true and lists every selected browser", () => {
        const { dir } = withDir(["--browsers", "chromium,firefox,webkit", "--combined-manifest"]);
        const combined = JSON.parse(
          readFileSync(join(dir, "schema-drift-manifest-combined.json"), "utf8"),
        );
        assertShape(combined);
        expect(combined.combined).toBe(true);
        expect(combined.browser).toBe("combined");
        expect(combined.browsers).toEqual(["chromium", "firefox", "webkit"]);
      });

      it("default (no --browsers) writes an <all> per-browser file with all keys", () => {
        const { dir } = withDir([]);
        const m = JSON.parse(readFileSync(join(dir, "schema-drift-manifest-all.json"), "utf8"));
        assertShape(m);
        expect(m.browser).toBe("<all>");
        expect(m.combined).toBe(false);
      });
    });
  });
});


