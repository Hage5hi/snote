// Test harness: verify the local reproduction scripts return matching
// non-zero exit codes AND emit consistent step-summary diagnostics when
// validate-pretty-index.py fails.
//
// We compare:
//   • scripts/check-pretty-index-local.sh --report <r> <file>
//   • scripts/reproduce-ci-pretty-index-check.sh [--matrix atomic|stress] <file>
//
// Contract:
//   1. Both scripts exit with the same non-zero code for the same bad input.
//   2. The reproduce script prints a step-summary-style block that names
//      the sibling .pre-check.json / .report.json files AND the matrix's
//      artifact prefix (atomic vs stress).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const LOCAL = resolve(REPO, "scripts", "check-pretty-index-local.sh");
const REPRO = resolve(REPO, "scripts", "reproduce-ci-pretty-index-check.sh");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) spawnSync("rm", ["-rf", d]);
});
function seed(body: string): { file: string; report: string } {
  const d = mkdtempSync(join(tmpdir(), "repro-harness-"));
  dirs.push(d);
  const file = join(d, "pretty-index.json");
  writeFileSync(file, body);
  return { file, report: join(d, "pretty-index.report.json") };
}

// Legacy v0 without --auto-migrate → validator exits 3 (schema drift).
const BAD = "[]";

describe("reproduce-ci-pretty-index-check.sh — exit + diagnostics harness", () => {
  it("matches check-pretty-index-local.sh's non-zero exit code", () => {
    const { file, report } = seed(BAD);
    const local = spawnSync("bash", [LOCAL, "--report", report, file], {
      encoding: "utf8",
    });
    const repro = spawnSync("bash", [REPRO, file], { encoding: "utf8" });

    expect(local.status).not.toBe(0);
    expect(repro.status).toBe(local.status);
  });

  it("emits step-summary diagnostics naming .pre-check.json + .report.json", () => {
    const { file } = seed(BAD);
    const r = spawnSync("bash", [REPRO, file], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/pretty-index\.json check failed/);
    expect(r.stderr).toContain(".pre-check.json");
    expect(r.stderr).toContain(".report.json");
  });

  it("--matrix atomic names the atomic-crossos artifact prefix", () => {
    const { file } = seed(BAD);
    const r = spawnSync("bash", [REPRO, "--matrix", "atomic", file], {
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(
      "schema-drift-diff-replay-pretty-index-failure",
    );
    expect(r.stderr).not.toContain(
      "schema-drift-diff-stress-replay-pretty-index-failure",
    );
  });

  it("--matrix stress names the nightly-stress artifact prefix", () => {
    const { file } = seed(BAD);
    const r = spawnSync("bash", [REPRO, "--matrix", "stress", file], {
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(
      "schema-drift-diff-stress-replay-pretty-index-failure",
    );
  });

  it("rejects an unknown --matrix value with exit 2", () => {
    const { file } = seed(BAD);
    const r = spawnSync("bash", [REPRO, "--matrix", "bogus", file], {
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--matrix must be atomic\|stress/);
    // Usage error must NOT print the validator-failure step-summary block
    // or any artifact prefix — those would mislead about what actually broke.
    expect(r.stderr).not.toContain("pretty-index.json check failed");
    expect(r.stderr).not.toContain(
      "schema-drift-diff-replay-pretty-index-failure",
    );
    expect(r.stderr).not.toContain(
      "schema-drift-diff-stress-replay-pretty-index-failure",
    );
  });

  it("make pretty-index-check MATRIX=bogus surfaces the same usage error", () => {
    const hasMake =
      spawnSync("make", ["--version"], { encoding: "utf8" }).status === 0;
    if (!hasMake) return;
    const { file } = seed(BAD);
    const r = spawnSync(
      "make",
      ["-s", "pretty-index-check", `INDEX=${file}`, "MATRIX=bogus"],
      { cwd: REPO, encoding: "utf8" },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--matrix must be atomic\|stress/);
    const combined = r.stderr + r.stdout;
    expect(combined).not.toContain("pretty-index.json check failed");
    expect(combined).not.toContain(
      "schema-drift-diff-replay-pretty-index-failure",
    );
    expect(combined).not.toContain(
      "schema-drift-diff-stress-replay-pretty-index-failure",
    );
  });

  it.each(["atomic", "stress"] as const)(
    "--clean removes ONLY the sibling .pre-check.json / .report.json for MATRIX=%s",
    (matrix) => {
      const { file } = seed(BAD);
      const pre = file.replace(/\.json$/, ".pre-check.json");
      const report = file.replace(/\.json$/, ".report.json");
      // Sibling that must NOT be touched (unrelated file in same dir).
      const bystander = join(file, "..", "unrelated.json");
      writeFileSync(bystander, "{}");
      // Seed prior diagnostics that --clean must delete.
      writeFileSync(pre, "stale-pre");
      writeFileSync(report, "stale-report");

      const r = spawnSync(
        "bash",
        [REPRO, "--clean", "--matrix", matrix, file],
        { encoding: "utf8" },
      );
      expect(r.status).not.toBe(0); // BAD input still fails
      const fs = require("node:fs") as typeof import("node:fs");
      // The scripts write fresh diagnostics after --clean, so files exist
      // but MUST no longer equal the stale sentinels.
      expect(fs.readFileSync(pre, "utf8")).not.toBe("stale-pre");
      const reportExists = fs.existsSync(report);
      if (reportExists) {
        expect(fs.readFileSync(report, "utf8")).not.toBe("stale-report");
      }
      // Unrelated sibling untouched.
      expect(fs.readFileSync(bystander, "utf8")).toBe("{}");
    },
  );

  it.each(["atomic", "stress"] as const)(
    "--clean is idempotent and touches only pretty-index sibling diagnostics for MATRIX=%s",
    (matrix) => {
      const { file } = seed(BAD);
      const pre = file.replace(/\.json$/, ".pre-check.json");
      const report = file.replace(/\.json$/, ".report.json");
      const fs = require("node:fs") as typeof import("node:fs");
      // Unrelated siblings that must survive every --clean invocation.
      const bystanders = {
        [join(file, "..", "unrelated.json")]: '{"keep":true}',
        [join(file, "..", "other.pre-check.json")]: "not-mine",
        [join(file, "..", "notes.report.json")]: "not-mine-either",
      };
      for (const [p, body] of Object.entries(bystanders)) writeFileSync(p, body);

      const run = () =>
        spawnSync("bash", [REPRO, "--clean", "--matrix", matrix, file], {
          encoding: "utf8",
        });

      // First --clean: no prior diagnostics — must not error on missing files.
      const r1 = run();
      expect(r1.status).not.toBe(0); // BAD input still fails validation
      expect(r1.stderr).not.toMatch(/no such file|cannot remove/i);

      // Second --clean: prior diagnostics exist — must remove them cleanly.
      const r2 = run();
      expect(r2.status).toBe(r1.status); // idempotent exit code

      // Bystanders untouched after both runs.
      for (const [p, body] of Object.entries(bystanders)) {
        expect(fs.readFileSync(p, "utf8")).toBe(body);
      }
      // Fresh diagnostics were re-written (not stale, not missing).
      expect(fs.existsSync(pre)).toBe(true);
      expect(fs.readFileSync(pre, "utf8").length).toBeGreaterThan(0);
    },
  );

  it("--clean preserves non-pretty-index files when both matrix artifact sets are present", () => {
    const { file } = seed(BAD);
    const dir = join(file, "..");
    const fs = require("node:fs") as typeof import("node:fs");
    // Simulate a diagnostics directory that has already run BOTH matrices,
    // plus a mix of unrelated artifacts a developer might have kept around.
    // Because atomic + stress share on-disk sibling names, the "sets" are
    // represented by the shared siblings PLUS unrelated per-matrix files
    // that must survive every --clean invocation.
    const pre = file.replace(/\.json$/, ".pre-check.json");
    const report = file.replace(/\.json$/, ".report.json");
    const nonPretty: Record<string, string> = {
      [join(dir, "unrelated.json")]: '{"keep":true}',
      [join(dir, "other-index.json")]: '{"other":true}',
      [join(dir, "other-index.pre-check.json")]: "other-pre",
      [join(dir, "other-index.report.json")]: "other-report",
      [join(dir, "atomic-run.log")]: "atomic log",
      [join(dir, "stress-run.log")]: "stress log",
      [join(dir, "notes.md")]: "# keep me",
    };
    for (const [p, body] of Object.entries(nonPretty)) writeFileSync(p, body);
    writeFileSync(pre, "stale-pre");
    writeFileSync(report, "stale-report");

    for (const matrix of ["atomic", "stress"] as const) {
      const r = spawnSync(
        "bash",
        [REPRO, "--clean", "--matrix", matrix, file],
        { encoding: "utf8" },
      );
      expect(r.status).not.toBe(0); // BAD input still fails
      // All non-pretty-index files untouched, regardless of matrix.
      for (const [p, body] of Object.entries(nonPretty)) {
        expect(fs.readFileSync(p, "utf8")).toBe(body);
      }
    }
  });

  it.each(["atomic", "stress"] as const)(
    "PRETTY_INDEX_HOOK_DRY_RUN=1 (MATRIX=%s) prints paths, exits 0, touches no diagnostics",
    (matrix) => {
      const HOOK = resolve(REPO, ".githooks", "pre-commit");
      const DIR = resolve(
        REPO,
        "artifacts/schema-drift-diff-replay-verify/pretty",
      );
      const fs = require("node:fs") as typeof import("node:fs");
      const PRE = join(DIR, "pretty-index.pre-check.json");
      const REPORT = join(DIR, "pretty-index.report.json");
      const snap = (p: string) =>
        fs.existsSync(p)
          ? { exists: true, body: fs.readFileSync(p, "utf8") }
          : { exists: false, body: "" };
      const before = { pre: snap(PRE), report: snap(REPORT) };

      const r = spawnSync("bash", [HOOK], {
        cwd: REPO,
        encoding: "utf8",
        env: {
          ...process.env,
          PRETTY_INDEX_HOOK_DRY_RUN: "1",
          PRETTY_INDEX_HOOK_MATRIX: matrix,
        },
      });
      expect(r.status).toBe(0);
      const out = r.stdout + r.stderr;
      expect(out).toContain(`[dry-run]: pretty-index gate (MATRIX=${matrix})`);
      expect(out).toContain("pretty-index.pre-check.json");
      expect(out).toContain("pretty-index.report.json");
      expect(out).toContain(
        matrix === "stress"
          ? "schema-drift-diff-stress-replay-pretty-index-failure"
          : "schema-drift-diff-replay-pretty-index-failure",
      );

      // Diagnostics untouched by dry-run.
      const after = { pre: snap(PRE), report: snap(REPORT) };
      expect(after).toEqual(before);
    },
  );

  it("make pretty-index-clean never removes files outside pretty-index siblings", () => {
    const hasMake =
      spawnSync("make", ["--version"], { encoding: "utf8" }).status === 0;
    if (!hasMake) return;
    const { file } = seed(BAD);
    const dir = join(file, "..");
    const fs = require("node:fs") as typeof import("node:fs");
    const pre = file.replace(/\.json$/, ".pre-check.json");
    const report = file.replace(/\.json$/, ".report.json");
    // Mix of unrelated artifacts from prior atomic + stress runs.
    const bystanders: Record<string, string> = {
      [join(dir, "unrelated.json")]: '{"keep":true}',
      [join(dir, "other-index.json")]: '{"other":true}',
      [join(dir, "other-index.pre-check.json")]: "other-pre",
      [join(dir, "other-index.report.json")]: "other-report",
      [join(dir, "atomic-run.log")]: "atomic",
      [join(dir, "stress-run.log")]: "stress",
    };
    for (const [p, body] of Object.entries(bystanders)) writeFileSync(p, body);
    writeFileSync(pre, "stale-pre");
    writeFileSync(report, "stale-report");

    const r = spawnSync(
      "make",
      ["-s", "pretty-index-clean", `INDEX=${file}`],
      { cwd: REPO, encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(fs.existsSync(pre)).toBe(false);
    expect(fs.existsSync(report)).toBe(false);
    for (const [p, body] of Object.entries(bystanders)) {
      expect(fs.readFileSync(p, "utf8")).toBe(body);
    }
    expect(fs.readFileSync(file, "utf8")).toBe(BAD);
  });

  it("--help lists supported PRETTY_INDEX_HOOK_MATRIX values and every documented exit code", () => {
    const HOOK = resolve(REPO, ".githooks", "pre-commit");
    const r = spawnSync("bash", [HOOK, "--help"], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    const out = r.stdout + r.stderr;
    // Supported matrix values, exactly as documented.
    expect(out).toMatch(/PRETTY_INDEX_HOOK_MATRIX=<value>\s+atomic \| stress/);
    // Every documented exit code, in order, with its label.
    expect(out).toContain("0  ok / dry-run / no relevant files staged");
    expect(out).toContain(
      "1  check failed (i18n allowlist drift OR pretty-index schema drift)",
    );
    expect(out).toContain(
      "2  usage error (invalid PRETTY_INDEX_HOOK_MATRIX value)",
    );
    expect(out).toContain("3  pretty-index schema validation failed");
    expect(out).toContain("4  pretty-index input file missing");
    // Both artifact prefixes documented per matrix.
    expect(out).toContain(
      "atomic  ->  schema-drift-diff-replay-pretty-index-failure-<os>",
    );
    expect(out).toContain(
      "stress  ->  schema-drift-diff-stress-replay-pretty-index-failure-<os>",
    );
  });

  it("--verbose prints resolved diagnostic dir + candidate file list in dry-run mode", () => {
    const HOOK = resolve(REPO, ".githooks", "pre-commit");
    const r = spawnSync("bash", [HOOK, "--verbose"], {
      cwd: REPO,
      encoding: "utf8",
      env: {
        ...process.env,
        PRETTY_INDEX_HOOK_DRY_RUN: "1",
        PRETTY_INDEX_HOOK_MATRIX: "atomic",
      },
    });
    expect(r.status).toBe(0);
    const out = r.stdout + r.stderr;
    expect(out).toContain("[verbose] resolved diagnostic directory:");
    expect(out).toContain("[verbose] candidate pretty-index files");
    // All three candidate siblings enumerated with exists/absent markers.
    expect(out).toMatch(/\[(exists|absent)\][^\n]*pretty-index\.json/);
    expect(out).toMatch(
      /\[(exists|absent)\][^\n]*pretty-index\.pre-check\.json/,
    );
    expect(out).toMatch(/\[(exists|absent)\][^\n]*pretty-index\.report\.json/);
  });
});



