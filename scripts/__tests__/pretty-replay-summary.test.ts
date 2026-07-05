// Tests for scripts/pretty-replay-summary.py and for the JSON schema
// contract of replay-summary.json produced by
// scripts/replay-schema-drift-diff-fuzz.sh.
//
// Covers:
//   1. Field order + missing-field skipping in the pretty printer.
//   2. `manifest_mapping` table formatting (headers, alignment, column
//      order) when the summary includes mappings.
//   3. Schema shape of a freshly generated `replay-summary.json`:
//      `fail_reason` is always present (even on success/empty), and
//      each `manifest_mapping` entry matches the documented schema
//      { manifest_entry: string, required_file: string, role: string }.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const HELPER = join(REPO, "scripts", "replay-schema-drift-diff-fuzz.sh");
const PRETTY = join(REPO, "scripts", "pretty-replay-summary.py");

const cleanups: string[] = [];
afterEach(() => {
  for (const d of cleanups.splice(0)) spawnSync("rm", ["-rf", d]);
});
function newWorkdir(): string {
  const d = mkdtempSync(join(tmpdir(), "pretty-replay-test-"));
  cleanups.push(d);
  return d;
}
function runPretty(inputPath: string) {
  return spawnSync("python3", [PRETTY, inputPath], { encoding: "utf8" });
}

describe("pretty-replay-summary.py formatting", () => {
  it("prints top-level fields in the documented order and skips missing ones", () => {
    const dir = newWorkdir();
    const file = join(dir, "s.json");
    writeFileSync(
      file,
      JSON.stringify({
        // intentionally shuffled + missing `duration_seconds`
        folder: "/tmp/x",
        pattern: "pat",
        mode: "dry-run",
        exit_code: null,
        checksum_verified: "ok",
        seed: "42",
        reader_ms: "100",
        timeout_ms: "30000",
        missing_files: [],
        fail_reason: "",
      }),
    );
    const r = runPretty(file);
    expect(r.status, r.stderr).toBe(0);
    const out = r.stdout;
    const order = [
      "mode",
      "exit_code",
      "checksum_verified",
      "seed",
      "reader_ms",
      "pattern",
      "timeout_ms",
      "missing_files",
      "fail_reason",
      "folder",
    ];
    const positions = order.map((k) => out.search(new RegExp(`^${k}\\s+:`, "m")));
    for (let i = 0; i < positions.length; i++) {
      expect(positions[i], `field ${order[i]} not found`).toBeGreaterThan(-1);
      if (i > 0) expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    // duration_seconds was omitted from input -> must not appear
    expect(out).not.toContain("duration_seconds");
    // empty list rendered as `(none)`, null as `(null)`, empty string preserved
    expect(out).toMatch(/^missing_files\s+: \(none\)$/m);
    expect(out).toMatch(/^exit_code\s+: \(null\)$/m);
    expect(out).toMatch(/^fail_reason\s+: $/m);
  });

  it("renders manifest_mapping as an aligned table with headers", () => {
    const dir = newWorkdir();
    const file = join(dir, "s.json");
    writeFileSync(
      file,
      JSON.stringify({
        mode: "dry-run",
        fail_reason: "",
        manifest_mapping: [
          { manifest_entry: "A_KEY", required_file: "/tmp/x/manifest.txt", role: "src of seed" },
          { manifest_entry: "LONGER_KEY_NAME", required_file: "/tmp/x/env.sh", role: "env pass" },
        ],
      }),
    );
    const r = runPretty(file);
    expect(r.status, r.stderr).toBe(0);
    const out = r.stdout;
    expect(out).toContain("-- manifest_mapping --");
    // header line with all three columns in order
    expect(out).toMatch(/manifest_entry\s+required_file\s+role/);
    // alignment: both entries indent role to the same column
    const rolePositions = out
      .split("\n")
      .filter((l) => l.includes("src of seed") || l.includes("env pass"))
      .map((l) => l.indexOf("src of seed") >= 0 ? l.indexOf("src of seed") : l.indexOf("env pass"));
    expect(rolePositions).toHaveLength(2);
    expect(rolePositions[0]).toBe(rolePositions[1]);
  });
});

describe("replay-summary.json schema contract", () => {
  function newestSummary(work: string): string {
    const root = join(work, "artifacts", "schema-drift-diff-replay");
    const entries = readdirSync(root).map((n) => join(root, n)).sort();
    return join(entries[entries.length - 1], "replay-summary.json");
  }
  function runHelper(args: string[], cwd: string) {
    return spawnSync("bash", [HELPER, ...args], {
      cwd, encoding: "utf8",
      env: { ...process.env, PATH: process.env.PATH ?? "" },
    });
  }

  it("always includes fail_reason (even on successful dry-run) and folder", () => {
    const work = newWorkdir();
    const r = runHelper(["11", "100", "pat", "--dry-run", "--json-summary"], work);
    expect(r.status, r.stderr).toBe(0);
    const summary = JSON.parse(readFileSync(newestSummary(work), "utf8"));
    expect(summary).toHaveProperty("fail_reason");
    expect(typeof summary.fail_reason).toBe("string");
    expect(summary.fail_reason).toBe("");
    expect(typeof summary.folder).toBe("string");
    expect(summary.mode).toBe("dry-run");
    expect(summary.checksum_verified).toBe("ok");
    // manifest_mapping present but empty without --verbose
    expect(Array.isArray(summary.manifest_mapping)).toBe(true);
    expect(summary.manifest_mapping).toEqual([]);
  });

  it("manifest_mapping under --verbose matches the documented schema", () => {
    const work = newWorkdir();
    const r = runHelper(
      ["22", "100", "pat", "--dry-run", "--json-summary", "--verbose"],
      work,
    );
    expect(r.status, r.stderr).toBe(0);
    const summary = JSON.parse(readFileSync(newestSummary(work), "utf8"));
    expect(Array.isArray(summary.manifest_mapping)).toBe(true);
    expect(summary.manifest_mapping.length).toBeGreaterThan(0);
    for (const entry of summary.manifest_mapping) {
      expect(Object.keys(entry).sort()).toEqual(
        ["manifest_entry", "required_file", "role"],
      );
      expect(typeof entry.manifest_entry).toBe("string");
      expect(typeof entry.required_file).toBe("string");
      expect(typeof entry.role).toBe("string");
      expect(entry.manifest_entry.length).toBeGreaterThan(0);
      expect(entry.required_file.length).toBeGreaterThan(0);
      expect(entry.role.length).toBeGreaterThan(0);
    }
    // at least one entry must reference each of the required files
    const files = summary.manifest_mapping.map((m: { required_file: string }) => m.required_file);
    expect(files.some((f: string) => f.endsWith("/manifest.txt"))).toBe(true);
    expect(files.some((f: string) => f.endsWith("/env.sh"))).toBe(true);
    expect(files.some((f: string) => f.endsWith("/checksums.sha256"))).toBe(true);
  });
});

describe("pretty-replay-summary.py exact-output snapshots", () => {
  // Stable, hand-crafted fixtures with fixed values so the exact
  // pretty-printed layout can be locked down. Any accidental change to
  // field order, padding widths, or the manifest_mapping table shape
  // will break these snapshots and force a deliberate update.
  const FIXTURE_NO_MAPPING = {
    mode: "dry-run",
    exit_code: null,
    duration_seconds: null,
    checksum_verified: "ok",
    seed: "42",
    reader_ms: "100",
    pattern: "pat",
    timeout_ms: "30000",
    missing_files: [],
    fail_reason: "",
    folder: "/tmp/x",
    manifest_mapping: [],
  };
  const FIXTURE_WITH_MAPPING = {
    ...FIXTURE_NO_MAPPING,
    seed: "22",
    folder: "/tmp/y",
    manifest_mapping: [
      { manifest_entry: "SCHEMA_DRIFT_DIFF_FUZZ_SEED",          required_file: "/tmp/y/manifest.txt",    role: "source of seed" },
      { manifest_entry: "SCHEMA_DRIFT_DIFF_READER_DURATION_MS", required_file: "/tmp/y/manifest.txt",    role: "source of reader window ms" },
      { manifest_entry: "(env passthrough)",                    required_file: "/tmp/y/env.sh",          role: "env vars sourced before replay" },
      { manifest_entry: "(integrity)",                          required_file: "/tmp/y/checksums.sha256", role: "sha256 of manifest.txt + env.sh" },
    ],
  };

  function pretty(fixture: unknown): string {
    const dir = newWorkdir();
    const file = join(dir, "s.json");
    writeFileSync(file, JSON.stringify(fixture));
    const r = runPretty(file);
    expect(r.status, r.stderr).toBe(0);
    return r.stdout;
  }

  it("no-mapping fixture: exact snapshot", () => {
    expect(pretty(FIXTURE_NO_MAPPING)).toMatchInlineSnapshot(`
      "== replay-summary ==
      mode              : dry-run
      exit_code         : (null)
      duration_seconds  : (null)
      checksum_verified : ok
      seed              : 42
      reader_ms         : 100
      pattern           : pat
      timeout_ms        : 30000
      missing_files     : (none)
      fail_reason       : 
      folder            : /tmp/x
      "
    `);
  });

  it("with-mapping fixture: exact snapshot including table", () => {
    expect(pretty(FIXTURE_WITH_MAPPING)).toMatchInlineSnapshot(`
      "== replay-summary ==
      mode              : dry-run
      exit_code         : (null)
      duration_seconds  : (null)
      checksum_verified : ok
      seed              : 22
      reader_ms         : 100
      pattern           : pat
      timeout_ms        : 30000
      missing_files     : (none)
      fail_reason       : 
      folder            : /tmp/y

      -- manifest_mapping --
        manifest_entry                        required_file            role
        ------------------------------------  -----------------------  ----
        SCHEMA_DRIFT_DIFF_FUZZ_SEED           /tmp/y/manifest.txt      source of seed
        SCHEMA_DRIFT_DIFF_READER_DURATION_MS  /tmp/y/manifest.txt      source of reader window ms
        (env passthrough)                     /tmp/y/env.sh            env vars sourced before replay
        (integrity)                           /tmp/y/checksums.sha256  sha256 of manifest.txt + env.sh
      "
    `);
  });
});

describe("pretty-replay-summary.py schema validation", () => {
  function writeFixture(f: unknown): string {
    const dir = newWorkdir();
    const p = join(dir, "s.json");
    writeFileSync(p, JSON.stringify(f));
    return p;
  }

  it("accepts a summary with NO manifest_mapping key (mapping is optional)", () => {
    const r = runPretty(writeFixture({ mode: "dry-run", fail_reason: "" }));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toContain("-- manifest_mapping --");
  });

  it("accepts a summary with an empty manifest_mapping array", () => {
    const r = runPretty(writeFixture({ mode: "dry-run", fail_reason: "", manifest_mapping: [] }));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toContain("-- manifest_mapping --");
  });

  it("rejects a manifest_mapping entry missing a required field", () => {
    const r = runPretty(
      writeFixture({
        mode: "dry-run",
        fail_reason: "",
        manifest_mapping: [{ manifest_entry: "X", required_file: "/f" /* role missing */ }],
      }),
    );
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/schema validation failed/);
    expect(r.stderr).toMatch(/manifest_mapping\[0\]\.role is missing/);
  });

  it("rejects a manifest_mapping entry with a wrong-typed field", () => {
    const r = runPretty(
      writeFixture({
        mode: "dry-run",
        fail_reason: "",
        manifest_mapping: [{ manifest_entry: "X", required_file: 123, role: "r" }],
      }),
    );
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/manifest_mapping\[0\]\.required_file must be a string/);
  });

  it("rejects a manifest_mapping that is not an array", () => {
    const r = runPretty(
      writeFixture({ mode: "dry-run", fail_reason: "", manifest_mapping: { oops: true } }),
    );
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/manifest_mapping must be an array/);
  });

  it("rejects a summary missing fail_reason entirely", () => {
    const r = runPretty(writeFixture({ mode: "dry-run" }));
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/fail_reason is missing/);
  });

  it("rejects a summary with a non-string fail_reason", () => {
    const r = runPretty(writeFixture({ mode: "dry-run", fail_reason: 0 }));
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/fail_reason must be a string/);
  });
});

describe("pretty-replay-summary.py IO / usage exit codes", () => {
  it("returns 4 when the input file does not exist", () => {
    const r = spawnSync("python3", [PRETTY, "/tmp/does-not-exist-xyz.json"], { encoding: "utf8" });
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/file not found/);
  });

  it("returns 6 when the file is not valid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "pretty-replay-test-"));
    cleanups.push(dir);
    const p = join(dir, "bad.json");
    writeFileSync(p, "{ not json ");
    const r = spawnSync("python3", [PRETTY, p], { encoding: "utf8" });
    expect(r.status).toBe(6);
    expect(r.stderr).toMatch(/cannot parse/);
  });

  it("returns 6 when top-level JSON is not an object", () => {
    const dir = mkdtempSync(join(tmpdir(), "pretty-replay-test-"));
    cleanups.push(dir);
    const p = join(dir, "arr.json");
    writeFileSync(p, "[1,2,3]");
    const r = spawnSync("python3", [PRETTY, p], { encoding: "utf8" });
    expect(r.status).toBe(6);
  });

  it("returns 2 on unknown flag", () => {
    const r = spawnSync("python3", [PRETTY, "--nope", "/tmp/x.json"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown flag/);
  });

  it("returns 2 with no arguments", () => {
    const r = spawnSync("python3", [PRETTY], { encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});

describe("pretty-replay-summary.py --fixed-widths deterministic rendering", () => {
  function pretty(fixture: unknown, args: string[] = []) {
    const dir = mkdtempSync(join(tmpdir(), "pretty-replay-test-"));
    cleanups.push(dir);
    const p = join(dir, "s.json");
    writeFileSync(p, JSON.stringify(fixture));
    return spawnSync("python3", [PRETTY, p, ...args], { encoding: "utf8" });
  }
  const base = { mode: "dry-run", fail_reason: "", manifest_mapping: [
    { manifest_entry: "A", required_file: "/f", role: "r1" },
    { manifest_entry: "MUCH_LONGER_KEY_NAME", required_file: "/some/other/file.txt", role: "r2" },
  ]};

  it("--fixed-widths produces identical column widths regardless of content", () => {
    const a = pretty(base, ["--fixed-widths"]);
    const b = pretty({
      ...base,
      manifest_mapping: [
        { manifest_entry: "Z", required_file: "/g", role: "r1" },
        { manifest_entry: "Y", required_file: "/h", role: "r2" },
      ],
    }, ["--fixed-widths"]);
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    // Header line must be identical byte-for-byte across different inputs.
    const headerA = a.stdout.split("\n").find(l => l.includes("manifest_entry"));
    const headerB = b.stdout.split("\n").find(l => l.includes("manifest_entry"));
    expect(headerA).toBe(headerB);
    // Explicit widths: entry=40, file=48.
    expect(headerA).toMatch(/manifest_entry {26} {2}required_file {35} {2}role/);
  });

  it("--no-color is accepted and does not alter output", () => {
    const a = pretty(base);
    const b = pretty(base, ["--no-color"]);
    expect(a.stdout).toBe(b.stdout);
  });
});

describe("pretty-replay-summary.py property/fuzz on malformed manifest_mapping", () => {
  // Deterministic PRNG so failures reproduce.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }
  function writeFixture(f: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "pretty-replay-test-"));
    cleanups.push(dir);
    const p = join(dir, "s.json");
    writeFileSync(p, JSON.stringify(f));
    return p;
  }
  const REQUIRED = ["manifest_entry", "required_file", "role"] as const;
  const BAD_VALUES: unknown[] = [null, 0, 1, true, false, [], {}, 3.14];

  it("any manifest_mapping entry with a missing or wrong-typed field is rejected (exit 3)", () => {
    const rand = rng(20260705);
    for (let i = 0; i < 40; i++) {
      const entry: Record<string, unknown> = {
        manifest_entry: "OK", required_file: "/f", role: "r",
      };
      // Pick one required key to mutate.
      const key = REQUIRED[Math.floor(rand() * REQUIRED.length)];
      if (rand() < 0.5) {
        delete entry[key]; // missing
      } else {
        entry[key] = BAD_VALUES[Math.floor(rand() * BAD_VALUES.length)]; // wrong type
      }
      const r = spawnSync("python3", [
        PRETTY,
        writeFixture({ mode: "dry-run", fail_reason: "", manifest_mapping: [entry] }),
      ], { encoding: "utf8" });
      expect(r.status, `iter ${i} entry=${JSON.stringify(entry)} stderr=${r.stderr}`).toBe(3);
      expect(r.stderr).toMatch(new RegExp(`manifest_mapping\\[0\\]\\.${key}`));
    }
  });

  it("random non-array manifest_mapping shapes are always rejected", () => {
    const shapes: unknown[] = [
      {}, { entries: [] }, 42, "oops", true, null,
    ];
    for (const shape of shapes) {
      const r = spawnSync("python3", [
        PRETTY,
        writeFixture({ mode: "dry-run", fail_reason: "", manifest_mapping: shape }),
      ], { encoding: "utf8" });
      // null => key still present but value null; validator treats it as
      // non-array. All shapes must fail with schema exit code.
      expect(r.status, `shape=${JSON.stringify(shape)}`).toBe(3);
      expect(r.stderr).toMatch(/manifest_mapping must be an array/);
    }
  });

  it("fail_reason remains required regardless of manifest_mapping shape", () => {
    const rand = rng(42);
    for (let i = 0; i < 20; i++) {
      // Well-formed mapping, but no fail_reason at all.
      const mapping = [];
      const n = 1 + Math.floor(rand() * 3);
      for (let j = 0; j < n; j++) {
        mapping.push({ manifest_entry: `E${j}`, required_file: `/f${j}`, role: `r${j}` });
      }
      const r = spawnSync("python3", [
        PRETTY,
        writeFixture({ mode: "dry-run", manifest_mapping: mapping }),
      ], { encoding: "utf8" });
      expect(r.status).toBe(3);
      expect(r.stderr).toMatch(/fail_reason is missing/);
    }
  });
});

describe("pretty-replay-summary.py CRLF vs LF input", () => {
  const FIXTURE = {
    mode: "dry-run",
    fail_reason: "",
    manifest_mapping: [
      { manifest_entry: "A", required_file: "/f", role: "r1" },
      { manifest_entry: "B_LONGER", required_file: "/x/y.txt", role: "r2" },
    ],
  };

  function run(raw: string): { status: number | null; stdout: string; stderr: string } {
    const dir = mkdtempSync(join(tmpdir(), "pretty-replay-test-"));
    cleanups.push(dir);
    const p = join(dir, "s.json");
    writeFileSync(p, raw);
    const r = spawnSync("python3", [PRETTY, "--fixed-widths", "--no-color", p], { encoding: "utf8" });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  it("--fixed-widths --no-color produces byte-identical output for LF and CRLF inputs", () => {
    const lf = JSON.stringify(FIXTURE, null, 2);
    const crlf = lf.replace(/\n/g, "\r\n");
    const a = run(lf);
    const b = run(crlf);
    expect(a.status, a.stderr).toBe(0);
    expect(b.status, b.stderr).toBe(0);
    expect(b.stdout).toBe(a.stdout);
    // Sanity: no stray \r bytes in output regardless of input EOLs.
    expect(a.stdout.includes("\r")).toBe(false);
    expect(b.stdout.includes("\r")).toBe(false);
  });
});

describe("pretty-replay-summary.py --markdown", () => {
  const FIXTURE = {
    mode: "dry-run",
    fail_reason: "",
    manifest_mapping: [
      { manifest_entry: "A", required_file: "/f", role: "r1" },
      { manifest_entry: "MUCH_LONGER_KEY_NAME", required_file: "/some/other/file.txt", role: "r2" },
    ],
  };

  function pretty(args: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "pretty-replay-test-"));
    cleanups.push(dir);
    const p = join(dir, "s.json");
    writeFileSync(p, JSON.stringify(FIXTURE));
    return spawnSync("python3", [PRETTY, p, ...args], { encoding: "utf8" });
  }

  it("renders a Markdown table with pipes and a divider row", () => {
    const r = pretty(["--markdown", "--fixed-widths", "--no-color"]);
    expect(r.status, r.stderr).toBe(0);
    const tableLines = r.stdout.split("\n").filter(l => l.startsWith("|"));
    // header + divider + 2 rows
    expect(tableLines.length).toBe(4);
    expect(tableLines[0]).toMatch(/^\| manifest_entry\s+\| required_file\s+\| role\s+\|$/);
    expect(tableLines[1]).toMatch(/^\| -+ \| -+ \| -+ \|$/);
    expect(tableLines[2]).toContain("| A ");
    expect(tableLines[3]).toContain("| MUCH_LONGER_KEY_NAME ");
    // All rows have equal length under --fixed-widths.
    const widths = new Set(tableLines.map(l => l.length));
    expect(widths.size).toBe(1);
  });

  it("without --markdown falls back to the plain aligned table", () => {
    const r = pretty(["--fixed-widths", "--no-color"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/^\|/m);
    expect(r.stdout).toContain("-- manifest_mapping --");
  });
});


