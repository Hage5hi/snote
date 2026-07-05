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
  });
});
