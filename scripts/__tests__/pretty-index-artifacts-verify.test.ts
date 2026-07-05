// Regression test for `make pretty-index-artifacts-verify`.
//
// Contract (documented in README "Interpreting failures" table):
//   • exit 0 → both dirs' sha256 checksums verify
//   • non-zero (make wraps recipe failures as exit 2) with distinguishing
//     stdout signatures:
//       - "MISMATCH"                       → corrupted / mutated bytes
//       - "<file>: FAILED open or read"    → a listed file is missing
//       - "_pretty-index-<matrix> missing" → dir absent (needs download)
//       - "pretty-index.checksums.sha256 missing" → artifact uploaded
//                                                   without checksums
//
// We run make in an isolated tempdir with hand-crafted _pretty-index-*
// fixtures, so we never touch the real repo working tree.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const MAKEFILE = resolve(REPO, "Makefile");

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Populate a _pretty-index-<matrix>/ dir with the 3 diagnostic files
 *  and a matching pretty-index.checksums.sha256. */
function seedDir(
  root: string,
  matrix: "atomic" | "stress",
  opts: { corruptReport?: boolean; missingPreCheck?: boolean; noChecksums?: boolean; missingDir?: boolean } = {},
) {
  if (opts.missingDir) return;
  const dir = join(root, `_pretty-index-${matrix}`);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    "pretty-index.json": `{"schema_version":1,"m":"${matrix}"}`,
    "pretty-index.pre-check.json": `{"raw":"${matrix}"}`,
    "pretty-index.report.json": `{"ok":true,"m":"${matrix}"}`,
  };
  // Write files (some scenarios omit / mutate specific ones AFTER
  // computing the checksums, so the checksums file itself stays honest).
  const lines: string[] = [];
  for (const [name, body] of Object.entries(files)) {
    lines.push(`${sha256(body)}  ${name}`);
    writeFileSync(join(dir, name), body);
  }
  if (!opts.noChecksums) {
    writeFileSync(
      join(dir, "pretty-index.checksums.sha256"),
      lines.join("\n") + "\n",
    );
  }
  if (opts.corruptReport) {
    writeFileSync(join(dir, "pretty-index.report.json"), "CORRUPTED-BYTES");
  }
  if (opts.missingPreCheck) {
    rmSync(join(dir, "pretty-index.pre-check.json"));
  }
}

function runVerify(cwd: string) {
  return spawnSync("make", ["-f", MAKEFILE, "pretty-index-artifacts-verify"], {
    cwd,
    encoding: "utf8",
  });
}

describe("make pretty-index-artifacts-verify — checksum regression", () => {
  it("exits 0 when both dirs have matching checksums", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-verify-ok-"));
    tmps.push(root);
    seedDir(root, "atomic");
    seedDir(root, "stress");
    const r = runVerify(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/pretty-index artifacts verified/);
  });

  it("exits 1 with per-file mismatch detail when a downloaded file is corrupted", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-verify-corrupt-"));
    tmps.push(root);
    seedDir(root, "atomic", { corruptReport: true });
    seedDir(root, "stress");
    const r = runVerify(root);
    expect(r.status).not.toBe(0);
    const out = r.stdout + r.stderr;
    // sha256sum's own FAILED line + our per-file diff line.
    expect(out).toMatch(/pretty-index\.report\.json:\s*FAILED/);
    expect(out).toMatch(
      /pretty-index\.report\.json\s+expected=[0-9a-f]{64}\s+actual=[0-9a-f]{64}\s+\[MISMATCH\]/,
    );
  });

  it("exits 1 when a downloaded file is missing (sha256sum reports FAILED open)", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-verify-miss-file-"));
    tmps.push(root);
    seedDir(root, "atomic", { missingPreCheck: true });
    seedDir(root, "stress");
    const r = runVerify(root);
    expect(r.status).not.toBe(0);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/pretty-index\.pre-check\.json/);
    expect(out).toContain("MISMATCH");
  });

  it("exits 2 when the entire downloaded directory is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-verify-miss-dir-"));
    tmps.push(root);
    seedDir(root, "atomic"); // only atomic; stress dir absent
    const r = runVerify(root);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(
      /_pretty-index-stress missing.*pretty-index-artifacts-download/,
    );
  });

  it("exits 2 when pretty-index.checksums.sha256 is absent from a downloaded dir", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-verify-miss-cks-"));
    tmps.push(root);
    seedDir(root, "atomic", { noChecksums: true });
    seedDir(root, "stress");
    const r = runVerify(root);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(
      /pretty-index\.checksums\.sha256 missing/,
    );
  });

  it("prints per-file expected AND actual sha256 hashes (distinct) on corruption", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-verify-hashes-"));
    tmps.push(root);
    seedDir(root, "atomic", { corruptReport: true });
    seedDir(root, "stress");
    const r = runVerify(root);
    expect(r.status).not.toBe(0);
    const out = r.stdout + r.stderr;
    const m = out.match(
      /pretty-index\.report\.json\s+expected=([0-9a-f]{64})\s+actual=([0-9a-f]{64})\s+\[MISMATCH\]/,
    );
    expect(m, `mismatch line not found in:\n${out}`).not.toBeNull();
    // expected and actual must be real, different hashes — proves the log
    // surfaces both sides of the diff, not just a generic "FAILED" line.
    expect(m![1]).not.toBe(m![2]);
    // actual hash must match sha256("CORRUPTED-BYTES") from the fixture.
    expect(m![2]).toBe(sha256("CORRUPTED-BYTES"));
  });
});

