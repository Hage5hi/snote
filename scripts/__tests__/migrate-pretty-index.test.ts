// Unit tests for scripts/migrate-pretty-index.py.
//
// Exit-code contract (mirrors validate-pretty-index.py):
//   0  migrated OK (or already current)
//   2  usage error
//   4  file missing
//   6  parse / unrecognized top-level shape
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const MIGRATE = join(REPO, "scripts", "migrate-pretty-index.py");
const VALIDATOR = join(REPO, "scripts", "validate-pretty-index.py");

const cleanups: string[] = [];
afterEach(() => {
  for (const d of cleanups.splice(0)) spawnSync("rm", ["-rf", d]);
});

function workdir(): string {
  const d = mkdtempSync(join(tmpdir(), "migrate-pretty-index-"));
  cleanups.push(d);
  return d;
}

function run(args: string[]) {
  return spawnSync("python3", [MIGRATE, ...args], { encoding: "utf8" });
}

function validEntry() {
  return {
    folder: "20260705T134402Z-seed-42",
    summary_file: "artifacts/x/replay-summary.json",
    pretty_txt: "artifacts/x/pretty.txt",
    pretty_md: "artifacts/x/pretty.md",
    fail_reason: "",
    exit_code: 0,
    pretty_status: "ok",
    pretty_exit_code: 0,
  };
}

describe("migrate-pretty-index.py", () => {
  it("exit 2 on missing positional argument", () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage:/);
  });

  it("exit 4 when the input file is missing", () => {
    const d = workdir();
    const r = run([join(d, "nope.json"), "--in-place"]);
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/file not found/);
  });

  it("exit 6 on unrecognized top-level shape", () => {
    const d = workdir();
    const f = join(d, "index.json");
    writeFileSync(f, JSON.stringify({ unrelated: true }));
    const r = run([f, "--in-place"]);
    expect(r.status).toBe(6);
    expect(r.stderr).toMatch(/unrecognized top-level shape/);
  });

  it("--in-place: migrates a legacy v0 array and prints before/after summary", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    const legacy = [validEntry(), validEntry()];
    writeFileSync(f, JSON.stringify(legacy));

    const r = run([f, "--in-place"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("== pretty-index migration ==");
    expect(r.stderr).toMatch(/from: v0 \(legacy array\)\s+entries: 2/);
    expect(r.stderr).toMatch(/to:\s+v1 \(envelope\)\s+entries: 2/);
    expect(r.stderr).toMatch(/\(in-place\)/);

    const migrated = JSON.parse(readFileSync(f, "utf8"));
    expect(migrated.schema_version).toBe(1);
    expect(migrated.entries).toHaveLength(2);

    // Roundtrip: validator accepts the migrated file with --require-version 1.
    const v = spawnSync(
      "python3",
      [VALIDATOR, "--require-version", "1", f],
      { encoding: "utf8" },
    );
    expect(v.status).toBe(0);
  });

  it("--output: writes to a new path and leaves the source unchanged", () => {
    const d = workdir();
    const src = join(d, "in.json");
    const dst = join(d, "out.json");
    const legacy = [validEntry()];
    const original = JSON.stringify(legacy);
    writeFileSync(src, original);

    const r = run([src, "--output", dst]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(dst);
    expect(readFileSync(src, "utf8")).toBe(original);
    const migrated = JSON.parse(readFileSync(dst, "utf8"));
    expect(migrated.schema_version).toBe(1);
    expect(migrated.entries).toHaveLength(1);
  });

  it("--dry-run: prints summary but writes nothing", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    const legacy = [validEntry()];
    const original = JSON.stringify(legacy);
    writeFileSync(f, original);

    const r = run([f, "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("== pretty-index migration ==");
    expect(r.stderr).toMatch(/dry-run/);
    // Source file is untouched.
    expect(readFileSync(f, "utf8")).toBe(original);
  });

  it("--in-place and --output are mutually exclusive", () => {
    const d = workdir();
    const f = join(d, "in.json");
    writeFileSync(f, JSON.stringify([validEntry()]));
    const r = run([f, "--in-place", "--output", join(d, "out.json")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/mutually exclusive/);
  });

  it("golden roundtrip: v0 -> migrate --in-place -> validate --require-version 1", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    const legacy = [validEntry(), validEntry(), validEntry()];
    writeFileSync(f, JSON.stringify(legacy));

    // Before migration: validator with --require-version 1 fails on v0.
    const before = spawnSync(
      "python3",
      [VALIDATOR, "--require-version", "1", f],
      { encoding: "utf8" },
    );
    expect(before.status).toBe(3);
    expect(before.stderr).toMatch(/schema_version=0/);

    // Migrate in place.
    const m = run([f, "--in-place"]);
    expect(m.status).toBe(0);
    expect(existsSync(f)).toBe(true);

    // After migration: validator passes.
    const after = spawnSync(
      "python3",
      [VALIDATOR, "--require-version", "1", f],
      { encoding: "utf8" },
    );
    expect(after.status).toBe(0);
  });

  it("validator --auto-migrate rewrites a legacy v0 file and passes", () => {
    const d = workdir();
    const f = join(d, "pretty-index.json");
    writeFileSync(f, JSON.stringify([validEntry()]));

    const r = spawnSync(
      "python3",
      [VALIDATOR, "--auto-migrate", "--require-version", "1", f],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("auto-migrating");
    expect(r.stderr).toContain("== pretty-index migration ==");

    const migrated = JSON.parse(readFileSync(f, "utf8"));
    expect(migrated.schema_version).toBe(1);
  });
});
