// Windows-focused harness for scripts/reproduce-ci-pretty-index-check.ps1.
//
// Runs the PowerShell reproduce script against a broken pretty-index.json
// and asserts:
//   1. its non-zero exit code matches the Bash reproduce script for the
//      same input (parity across the two supported platforms), and
//   2. its stderr step-summary block names the sibling .pre-check.json /
//      .report.json diagnostic files AND the matrix-specific artifact
//      prefix (atomic vs stress).
//
// Skipped automatically when `pwsh` is not on PATH (typical on Linux CI
// runners without PowerShell installed). The Windows CI job DOES have
// pwsh, so this exercises the real script there.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const REPRO_SH = resolve(REPO, "scripts", "reproduce-ci-pretty-index-check.sh");
const REPRO_PS1 = resolve(REPO, "scripts", "reproduce-ci-pretty-index-check.ps1");

const hasPwsh = spawnSync("pwsh", ["-NoLogo", "-Command", "$PSVersionTable.PSVersion.Major"], {
  encoding: "utf8",
}).status === 0;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) spawnSync("rm", ["-rf", d]);
});
function seed(body: string): string {
  const d = mkdtempSync(join(tmpdir(), "repro-pwsh-"));
  dirs.push(d);
  const file = join(d, "pretty-index.json");
  writeFileSync(file, body);
  return file;
}

// Legacy v0 without --auto-migrate → validator exits non-zero (schema drift).
const BAD = "[]";

describe.skipIf(!hasPwsh)("reproduce-ci-pretty-index-check.ps1 — Windows harness", () => {
  it("exit code matches the Bash reproduce script for the same broken input", () => {
    const file = seed(BAD);
    const sh = spawnSync("bash", [REPRO_SH, file], { encoding: "utf8" });
    const ps = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-File", REPRO_PS1, file],
      { encoding: "utf8" },
    );
    expect(sh.status).not.toBe(0);
    expect(ps.status).toBe(sh.status);
  });

  it("stderr step-summary names .pre-check.json + .report.json diagnostics", () => {
    const file = seed(BAD);
    const ps = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-File", REPRO_PS1, file],
      { encoding: "utf8" },
    );
    expect(ps.status).not.toBe(0);
    expect(ps.stderr).toMatch(/pretty-index\.json check failed/);
    expect(ps.stderr).toContain(".pre-check.json");
    expect(ps.stderr).toContain(".report.json");
  });

  it("-Matrix atomic emits the atomic-crossos artifact prefix + exact sibling filenames", () => {
    const file = seed(BAD);
    const ps = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-File", REPRO_PS1, "-Matrix", "atomic", file],
      { encoding: "utf8" },
    );
    expect(ps.status).not.toBe(0);
    expect(ps.stderr).toContain("schema-drift-diff-replay-pretty-index-failure");
    expect(ps.stderr).not.toContain("schema-drift-diff-stress-replay-pretty-index-failure");
    // Sibling artifact names must be rendered exactly (no drift in naming).
    expect(ps.stderr).toContain("pretty-index.json");
    expect(ps.stderr).toContain("pretty-index.pre-check.json");
    expect(ps.stderr).toContain("pretty-index.report.json");
    expect(ps.stderr).toContain("(matrix: atomic)");
  });

  it("-Matrix stress emits the nightly-stress artifact prefix + exact sibling filenames", () => {
    const file = seed(BAD);
    const ps = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-File", REPRO_PS1, "-Matrix", "stress", file],
      { encoding: "utf8" },
    );
    expect(ps.status).not.toBe(0);
    expect(ps.stderr).toContain("schema-drift-diff-stress-replay-pretty-index-failure");
    expect(ps.stderr).toContain("pretty-index.json");
    expect(ps.stderr).toContain("pretty-index.pre-check.json");
    expect(ps.stderr).toContain("pretty-index.report.json");
    expect(ps.stderr).toContain("(matrix: stress)");
  });

  it("rejects an unknown -Matrix value (PowerShell ValidateSet)", () => {
    const file = seed(BAD);
    const ps = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-File", REPRO_PS1, "-Matrix", "bogus", file],
      { encoding: "utf8" },
    );
    expect(ps.status).not.toBe(0);
  });
});

// Sanity: when pwsh is missing, at least assert the script file exists and
// has the expected ValidateSet so the contract is checked on every platform.
describe.skipIf(hasPwsh)("reproduce-ci-pretty-index-check.ps1 — static contract (no pwsh)", () => {
  it("declares -Matrix atomic|stress ValidateSet", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(REPRO_PS1, "utf8");
    expect(src).toMatch(/ValidateSet\(\s*["']atomic["']\s*,\s*["']stress["']\s*\)/);
    expect(src).toContain("schema-drift-diff-replay-pretty-index-failure");
    expect(src).toContain("schema-drift-diff-stress-replay-pretty-index-failure");
  });
});
