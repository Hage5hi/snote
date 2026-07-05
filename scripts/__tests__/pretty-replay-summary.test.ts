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
    expect(pretty(FIXTURE_NO_MAPPING)).toMatchInlineSnapshot();
  });

  it("with-mapping fixture: exact snapshot including table", () => {
    expect(pretty(FIXTURE_WITH_MAPPING)).toMatchInlineSnapshot();
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
