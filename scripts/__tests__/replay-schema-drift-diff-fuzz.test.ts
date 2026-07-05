// Tests for scripts/replay-schema-drift-diff-fuzz.sh covering the
// non-vitest-executing flags: --dry-run (checksum verification + summary),
// --test-name-pattern (override precedence), and --print-manifest
// (formatted output). These flags never invoke vitest so they're safe to
// run in-band; we only shell out to the helper itself.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const HELPER = join(REPO, "scripts", "replay-schema-drift-diff-fuzz.sh");

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    try { spawnSync("rm", ["-rf", dir]); } catch { /* noop */ }
  }
});

function runHelper(args: string[], cwd: string) {
  return spawnSync("bash", [HELPER, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH ?? "" },
  });
}

function newWorkdir(): string {
  const dir = mkdtempSync(join(tmpdir(), "replay-helper-test-"));
  cleanups.push(dir);
  return dir;
}

function newestReplayFolder(work: string): string {
  const root = join(work, "artifacts", "schema-drift-diff-replay");
  const entries = readdirSync(root).map((n) => join(root, n));
  entries.sort();
  return entries[entries.length - 1];
}

describe("replay-schema-drift-diff-fuzz.sh --dry-run", () => {
  it("verifies checksums, writes replay-summary.txt, and does not invoke vitest", () => {
    const work = newWorkdir();
    const r = runHelper(["12345", "250", "custom pattern zz", "--dry-run"], work);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain("pre-replay: OK   checksums verified");
    expect(r.stderr).toContain("dry-run: verification complete, not executing vitest");

    const folder = newestReplayFolder(work);
    const summary = readFileSync(join(folder, "replay-summary.txt"), "utf8");
    expect(summary).toContain("mode:                dry-run");
    expect(summary).toContain("checksum_verified:   ok");
    expect(summary).toContain("seed:                12345");
    expect(summary).toContain("reader_ms:           250");
    expect(summary).toContain("pattern:             custom pattern zz");
    expect(summary).toMatch(/would_run:.*bunx vitest run .* -t custom pattern zz .*--testTimeout=30000/);

    // Dry-run must NOT have executed vitest -> no exit_code.txt / postrun sums.
    expect(existsSync(join(folder, "exit_code.txt"))).toBe(false);
    expect(existsSync(join(folder, "checksums.postrun.sha256"))).toBe(false);
  });

  it("--from a tampered folder fails with exit 8 on checksum mismatch", () => {
    const work = newWorkdir();
    // Create a valid folder first via a dry-run.
    const seed = runHelper(["777", "100", "orig pattern", "--dry-run"], work);
    expect(seed.status, seed.stderr).toBe(0);
    const folder = newestReplayFolder(work);
    // Tamper with the manifest so its sha256 no longer matches.
    writeFileSync(join(folder, "manifest.txt"), readFileSync(join(folder, "manifest.txt"), "utf8") + "tampered\n");

    const replay = runHelper(["--from", folder, "--dry-run"], work);
    expect(replay.status).toBe(8);
    expect(replay.stderr).toMatch(/--from: FAIL checksum mismatch/);
  });
});

describe("replay-schema-drift-diff-fuzz.sh --test-name-pattern", () => {
  it("override takes precedence over the manifest pattern", async () => {
    const work = newWorkdir();
    // Create source folder with pattern "orig".
    const first = runHelper(["999", "100", "orig", "--dry-run"], work);
    expect(first.status, first.stderr).toBe(0);
    const src = newestReplayFolder(work);

    // Sleep >1s so the re-exec's timestamped folder gets a different name
    // (the helper's timestamp granularity is one second).
    await new Promise((r) => setTimeout(r, 1100));

    // Replay from that folder but override the pattern.
    const overridden = runHelper(
      ["--from", src, "--test-name-pattern", "OVERRIDDEN_PATTERN", "--dry-run"],
      work,
    );
    expect(overridden.status, overridden.stderr).toBe(0);

    // The `--from` path re-execs the helper with positional args, producing
    // a fresh replay folder; that folder's summary should reflect the override.
    const latest = newestReplayFolder(work);
    expect(latest).not.toBe(src);
    const summary = readFileSync(join(latest, "replay-summary.txt"), "utf8");
    expect(summary).toContain("pattern:             OVERRIDDEN_PATTERN");
    expect(summary).toMatch(/would_run:.* -t OVERRIDDEN_PATTERN /);
  });


  it("positional --test-name-pattern beats the 3rd positional pattern arg", () => {
    const work = newWorkdir();
    const r = runHelper(["42", "150", "positional-pat", "--test-name-pattern", "flag-pat", "--dry-run"], work);
    expect(r.status, r.stderr).toBe(0);
    const summary = readFileSync(join(newestReplayFolder(work), "replay-summary.txt"), "utf8");
    expect(summary).toContain("pattern:             flag-pat");
  });
});

describe("replay-schema-drift-diff-fuzz.sh --print-manifest", () => {
  it("prints the manifest plus a derived seed/reader/pattern block", () => {
    const work = newWorkdir();
    const seed = runHelper(["4242", "500", "some-pat", "--dry-run"], work);
    expect(seed.status, seed.stderr).toBe(0);
    const src = newestReplayFolder(work);

    const printed = runHelper(["--from", src, "--print-manifest"], work);
    expect(printed.status, printed.stderr).toBe(0);
    const out = printed.stdout;
    expect(out).toContain(`== manifest: ${join(src, "manifest.txt")} ==`);
    expect(out).toContain("SCHEMA_DRIFT_DIFF_FUZZ_SEED:            4242");
    expect(out).toContain("-- derived --");
    expect(out).toContain("seed          = 4242");
    expect(out).toContain("reader_ms     = 500");
    expect(out).toContain("test_pattern  = some-pat");
    expect(out).toContain("timeout_ms    = 30000");
  });
});
