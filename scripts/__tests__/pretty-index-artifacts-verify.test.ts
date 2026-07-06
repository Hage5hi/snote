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

// ─────────────────────────────────────────────────────────────────────────
// Tests for the mismatch-report inspection targets:
//   pretty-index-mismatch-summary
//   pretty-index-mismatch-summary-json
//   pretty-index-mismatch-csv
//   pretty-index-mismatch-show (PI_PATH_GLOB)
//   pretty-index-mismatch-diff (PI_BASELINE)
// Contract: exit-code semantics documented in README "Exit codes for
// mismatch-inspection targets" table (3/4/2 for summary/diff/report-absent).
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from "node:fs";

function runTarget(cwd: string, target: string, env: Record<string, string> = {}) {
  return spawnSync("make", ["-f", MAKEFILE, target], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/** Seed a mismatch report by running verify against a corrupted fixture. */
function seedReport(root: string, opts: { missingStressDir?: boolean } = {}) {
  seedDir(root, "atomic", { corruptReport: true });
  if (!opts.missingStressDir) seedDir(root, "stress");
  runVerify(root); // writes _pretty-index-checksum-mismatch.json
}

describe("pretty-index mismatch-report inspection targets", () => {
  it("summary exits non-zero when mismatches exist and prints per-matrix counts", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-sum-"));
    tmps.push(root);
    seedReport(root);
    const r = runTarget(root, "pretty-index-mismatch-summary");
    // Recipe emits `exit 3`; make wraps recipe failures as exit 2.
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/Error 3/);
    expect(r.stdout).toMatch(/atomic:\s+1\/\d+ mismatched/);
    expect(r.stdout).toMatch(/total:\s+1\//);
  });

  it("summary-json writes a v1 JSON with per-matrix + totals counts", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-sumj-"));
    tmps.push(root);
    seedReport(root, { missingStressDir: true });
    const out = join(root, "summary.json");
    const r = runTarget(root, "pretty-index-mismatch-summary-json", {
      PI_SUMMARY_JSON_PATH: out,
    });
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    const j = JSON.parse(readFileSync(out, "utf8"));
    expect(j.schema).toBe("pretty-index-mismatch-summary/v1");
    expect(j.matrices.atomic.mismatched).toBe(1);
    expect(j.matrices.stress.missing).toBe(1);
    expect(j.totals.mismatched).toBe(1);
    expect(j.totals.missing).toBe(1);
  });

  it("csv export writes a header + one row per result", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-csv-"));
    tmps.push(root);
    seedReport(root);
    const out = join(root, "mismatch.csv");
    const r = runTarget(root, "pretty-index-mismatch-csv", {
      PI_CSV_PATH: out,
    });
    expect(r.status).toBe(0);
    const csv = readFileSync(out, "utf8");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("matrix,artifact_dir,path,expected_hash,actual_hash");
    // At least one row referencing the corrupted report file.
    expect(csv).toMatch(/pretty-index\.report\.json/);
    expect(lines.length).toBeGreaterThan(1);
  });

  it("show with PI_PATH_GLOB filters rows by .path", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-glob-"));
    tmps.push(root);
    seedReport(root);
    // Glob syntax (not regex): `*` matches any chars. Match only
    // *report.json (excludes pre-check.json and pretty-index.json).
    const matched = runTarget(root, "pretty-index-mismatch-show", {
      PI_PATH_GLOB: "*report.json",
    });
    expect(matched.status).toBe(0);
    expect(matched.stdout).toMatch(/pretty-index\.report\.json/);
    expect(matched.stdout).not.toMatch(/pretty-index\.pre-check\.json/);

    // A glob that matches nothing → target still exits 0 with no rows.
    const empty = runTarget(root, "pretty-index-mismatch-show", {
      PI_PATH_GLOB: "no-such-file-xyz",
    });
    expect(empty.status).toBe(0);
    expect(empty.stdout).not.toMatch(/pretty-index\.report\.json/);
  });

  it("diff detects NEW entries vs baseline (non-zero) and matches equal baseline (zero)", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-diff-"));
    tmps.push(root);
    seedReport(root);
    const reportPath = join(root, "_pretty-index-checksum-mismatch.json");
    const baseline = join(root, "baseline.json");
    writeFileSync(
      baseline,
      JSON.stringify({
        schema: "pretty-index-checksum-mismatch/v1",
        scope: "both",
        results: [],
      }),
    );
    // Baseline = empty results → current has NEW entries. Recipe emits
    // `exit 4`; make wraps recipe failures as exit 2.
    const rDiff = runTarget(root, "pretty-index-mismatch-diff", {
      PI_BASELINE: baseline,
    });
    expect(rDiff.status).not.toBe(0);
    expect(rDiff.stderr + rDiff.stdout).toMatch(/Error 4/);
    expect(rDiff.stdout).toMatch(/\[NEW\]/);

    // Equal → exit 0.
    const rSame = runTarget(root, "pretty-index-mismatch-diff", {
      PI_BASELINE: reportPath,
    });
    expect(rSame.status).toBe(0);
    expect(rSame.stdout).toMatch(/diff entries: 0/);
  });
});



// ─────────────────────────────────────────────────────────────────────────
// Tests for pretty-index-mismatch-summary-md, -summary-validate exit
// codes, -summary-json-merge exit codes, and diff-report artifact output.
// ─────────────────────────────────────────────────────────────────────────
describe("pretty-index-mismatch-summary-md — markdown generation", () => {
  const validSummary = {
    schema: "pretty-index-mismatch-summary/v1",
    scope: "atomic",
    matrices: {
      atomic: { total: 3, mismatched: 1, missing: 0 },
      stress: { total: 2, mismatched: 0, missing: 1 },
    },
    totals: { total: 5, mismatched: 1, missing: 1 },
  };

  it("emits header, source path, schema, and per-matrix + totals rows", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-md-"));
    tmps.push(root);
    const summary = join(root, "summary.json");
    const out = join(root, "summary.md");
    writeFileSync(summary, JSON.stringify(validSummary));
    const r = runTarget(root, "pretty-index-mismatch-summary-md", {
      PI_SUMMARY_JSON_PATH: summary,
      PI_SUMMARY_MD_PATH: out,
    });
    expect(r.status).toBe(0);
    const md = readFileSync(out, "utf8");
    expect(md).toMatch(/^# pretty-index mismatch summary/m);
    expect(md).toContain(`\`${summary}\``);
    expect(md).toContain("`pretty-index-mismatch-summary/v1`");
    expect(md).toContain("`atomic`");
    // per-matrix rows
    expect(md).toMatch(/\|\s*atomic\s*\|\s*3\s*\|\s*1\s*\|\s*0\s*\|/);
    expect(md).toMatch(/\|\s*stress\s*\|\s*2\s*\|\s*0\s*\|\s*1\s*\|/);
    // totals row
    expect(md).toMatch(/\|\s*\*\*total\*\*\s*\|\s*5\s*\|\s*1\s*\|\s*1\s*\|/);
    // no merged-sources section for a single-scope summary
    expect(md).not.toMatch(/## merged sources/);
  });

  it("emits a merged-sources table with per-source links when merged_from is present", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-md-merged-"));
    tmps.push(root);
    const summary = join(root, "merged.json");
    const out = join(root, "merged.md");
    writeFileSync(
      summary,
      JSON.stringify({
        schema: "pretty-index-mismatch-summary-merged/v1",
        merged_from: ["a.json", "b.json"],
        sources: [
          { path: "a.json", scope: "atomic", missing: false, totals: { total: 3, mismatched: 1, missing: 0 } },
          { path: "b.json", scope: "stress", missing: true,  totals: { total: 0, mismatched: 0, missing: 0 } },
        ],
        matrices: { atomic: { total: 3, mismatched: 1, missing: 0 }, stress: { total: 0, mismatched: 0, missing: 0 } },
        totals:   { total: 3, mismatched: 1, missing: 0 },
      }),
    );
    const r = runTarget(root, "pretty-index-mismatch-summary-md", {
      PI_SUMMARY_JSON_PATH: summary,
      PI_SUMMARY_MD_PATH: out,
    });
    expect(r.status).toBe(0);
    const md = readFileSync(out, "utf8");
    expect(md).toContain("## merged sources");
    expect(md).toMatch(/\|\s*a\.json\s*\|\s*atomic\s*\|\s*false\s*\|\s*3\s*\|\s*1\s*\|\s*0\s*\|/);
    expect(md).toMatch(/\|\s*b\.json\s*\|\s*stress\s*\|\s*true\s*\|/);
  });
});

describe("pretty-index-mismatch-summary-validate — documented exit codes", () => {
  const repoSchema = join(REPO, "schemas/pretty-index-mismatch-summary-json.schema.json");
  function seedSchema(root: string) {
    mkdirSync(join(root, "schemas"), { recursive: true });
    writeFileSync(
      join(root, "schemas/pretty-index-mismatch-summary-json.schema.json"),
      readFileSync(repoSchema, "utf8"),
    );
  }

  it("exits 0 on a valid v1 summary", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-validate-ok-"));
    tmps.push(root);
    seedSchema(root);
    const f = join(root, "summary.json");
    writeFileSync(f, JSON.stringify({
      schema: "pretty-index-mismatch-summary/v1",
      matrices: { atomic: { total: 0, mismatched: 0, missing: 0 }, stress: { total: 0, mismatched: 0, missing: 0 } },
      totals: { total: 0, mismatched: 0, missing: 0 },
    }));
    const r = runTarget(root, "pretty-index-mismatch-summary-validate", { PI_SUMMARY_JSON_PATH: f });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^OK/m);
  });

  it("exits 2 when the summary file is missing (documented tooling/file-missing code)", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-validate-miss-"));
    tmps.push(root);
    seedSchema(root);
    const r = runTarget(root, "pretty-index-mismatch-summary-validate", {
      PI_SUMMARY_JSON_PATH: join(root, "does-not-exist.json"),
    });
    expect(r.status).not.toBe(0);
    // recipe emits exit 2 → make wraps as Error 2
    expect(r.stderr).toMatch(/no summary at path=/);
  });

  it("exits 5 on schema/shape violation and prints the failing JSON path", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-validate-bad-"));
    tmps.push(root);
    seedSchema(root);
    const f = join(root, "summary.json");
    writeFileSync(f, JSON.stringify({
      schema: "pretty-index-mismatch-summary/v1",
      matrices: { atomic: { total: -1 }, stress: {} }, // both matrices invalid
      totals: { total: 0, mismatched: 0, missing: 0 },
    }));
    const r = runTarget(root, "pretty-index-mismatch-summary-validate", { PI_SUMMARY_JSON_PATH: f });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Error 5/);
    expect(r.stderr).toMatch(/path=\.matrices\.atomic\.total/);
  });

  it("exits 0 with a deprecation warning for legacy schema v0", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-validate-v0-"));
    tmps.push(root);
    seedSchema(root);
    const f = join(root, "summary.json");
    writeFileSync(f, JSON.stringify({ schema: "pretty-index-mismatch-summary/v0" }));
    const r = runTarget(root, "pretty-index-mismatch-summary-validate", { PI_SUMMARY_JSON_PATH: f });
    expect(r.status).toBe(0);
    expect(r.stderr + r.stdout).toMatch(/DEPRECATED/);
  });

  it("emits ::error:: GHA annotations when GITHUB_ACTIONS=true", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-validate-gha-"));
    tmps.push(root);
    seedSchema(root);
    const f = join(root, "summary.json");
    writeFileSync(f, JSON.stringify({ schema: "wrong", matrices: {}, totals: {} }));
    const r = runTarget(root, "pretty-index-mismatch-summary-validate", {
      PI_SUMMARY_JSON_PATH: f,
      GITHUB_ACTIONS: "true",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/::error file=/);
  });
});

describe("pretty-index-mismatch-summary-json-merge — documented exit codes", () => {
  it("exits 2 when PI_SUMMARY_INPUTS is empty", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-merge-noargs-"));
    tmps.push(root);
    const r = runTarget(root, "pretty-index-mismatch-summary-json-merge", {
      PI_SUMMARY_MERGED_PATH: join(root, "merged.json"),
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usage:/);
  });

  it("exits 0 and tolerates missing inputs, recording sources[].missing=true", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-merge-missing-"));
    tmps.push(root);
    const good = join(root, "a.json");
    const absent = join(root, "b-missing.json");
    writeFileSync(good, JSON.stringify({
      schema: "pretty-index-mismatch-summary/v1",
      scope: "atomic",
      matrices: { atomic: { total: 3, mismatched: 1, missing: 0 }, stress: { total: 0, mismatched: 0, missing: 0 } },
      totals: { total: 3, mismatched: 1, missing: 0 },
    }));
    const out = join(root, "merged.json");
    const r = runTarget(root, "pretty-index-mismatch-summary-json-merge", {
      PI_SUMMARY_INPUTS: `${good} ${absent}`,
      PI_SUMMARY_MERGED_PATH: out,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/warn: missing input/);
    const j = JSON.parse(readFileSync(out, "utf8"));
    expect(j.schema).toBe("pretty-index-mismatch-summary-merged/v1");
    expect(j.totals.mismatched).toBe(1);
    const missingSrc = j.sources.find((s: any) => s.path === absent);
    expect(missingSrc?.missing).toBe(true);
    expect(missingSrc?.totals).toEqual({ total: 0, mismatched: 0, missing: 0 });
  });
});

describe("pretty-index-mismatch-diff — writes machine-readable diff report when PI_DIFF_OUT_PATH is set", () => {
  it("writes pretty-index-mismatch-diff/v1 JSON alongside NEW entries and exits 4", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-diff-out-"));
    tmps.push(root);
    seedReport(root);
    const baseline = join(root, "baseline.json");
    writeFileSync(baseline, JSON.stringify({
      schema: "pretty-index-checksum-mismatch/v1", scope: "both", results: [],
    }));
    const diffOut = join(root, "diff.json");
    const r = runTarget(root, "pretty-index-mismatch-diff", {
      PI_BASELINE: baseline,
      PI_DIFF_OUT_PATH: diffOut,
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/Error 4/);
    expect(existsSync(diffOut)).toBe(true);
    const j = JSON.parse(readFileSync(diffOut, "utf8"));
    expect(j.schema).toBe("pretty-index-mismatch-diff/v1");
    expect(j.baseline).toBe(baseline);
    expect(j.count).toBeGreaterThan(0);
    expect(Array.isArray(j.entries)).toBe(true);
    expect(j.entries[0].change).toBe("NEW");
  });
});
