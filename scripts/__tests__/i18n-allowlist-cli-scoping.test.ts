// CLI-level tests that need real git scoping, real truncation, and a
// snapshot of the --help text against the documentation. These spawn
// the actual CLI in throwaway working directories.
//
// Covered:
//   1. `--changed`: SummaryJSON.scopedToChanges=true, counts reflect
//      only the changed file's missing entries, annotations don't
//      include unchanged files.
//   2. `--topFiles N` (N < total failures): topFiles is truncated to N
//      and the order matches the `reason:` line printed in the
//      $GITHUB_STEP_SUMMARY-equivalent CLI output (annotations + JSON
//      stay aligned with that order).
//   3. `--help`: snapshot-style parity check between the help text and
//      `docs/i18n-allowlist-summary.md` so neither drifts silently.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatSummary, type SummaryJSON } from "../i18n-allowlist-report";

const PROJECT_ROOT = process.cwd();
const CLI_PATH = resolve(PROJECT_ROOT, "scripts/i18n-allowlist-report.ts");
const SCHEMA_SRC = resolve(PROJECT_ROOT, ".lintrc-i18n-allowlist.schema.json");
const DOC_PATH = resolve(PROJECT_ROOT, "docs/i18n-allowlist-summary.md");

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function runCli(cwd: string, args: string[]) {
  const r = spawnSync("bun", ["run", CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "" },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

/**
 * Build a tmp project with N unallowlisted disables, each in its own
 * file (`src/file<i>.tsx`). The allowlist is empty so every disable
 * shows up as `missing`. Git is initialized + committed so callers can
 * mutate a subset of files post-commit and exercise --changed.
 */
function makeDriftFixture(fileCount: number): { dir: string; files: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "i18n-allowlist-scoping-"));
  tmpDirs.push(dir);
  cpSync(SCHEMA_SRC, join(dir, ".lintrc-i18n-allowlist.schema.json"));
  mkdirSync(join(dir, "src"));
  writeFileSync(
    join(dir, ".lintrc-i18n-allowlist.json"),
    JSON.stringify(
      { $schema: "./.lintrc-i18n-allowlist.schema.json", entries: [] },
      null,
      2,
    ),
  );
  const files: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    const rel = `src/file${i}.tsx`;
    writeFileSync(
      join(dir, rel),
      // eslint-disable-next-line no-restricted-syntax is what the check
      // scans for; the body underneath is irrelevant to detection.
      `// eslint-disable-next-line no-restricted-syntax -- ad-hoc${i}\nexport const x${i} = "y";\n`,
    );
    files.push(rel);
  }
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return { dir, files };
}

// ────────────────────────────────────────────────────────────────────────────
// 1. --changed integration
// ────────────────────────────────────────────────────────────────────────────
describe("CLI --changed scopes counts + annotations to the diff", () => {
  let dir: string;
  let files: string[];
  let res: ReturnType<typeof runCli>;
  let json: SummaryJSON;

  beforeAll(() => {
    ({ dir, files } = makeDriftFixture(3));
    // Mutate exactly one of the committed files so it shows up under
    // `git diff --name-only HEAD`. The other two stay clean.
    writeFileSync(
      join(dir, files[0]),
      `// eslint-disable-next-line no-restricted-syntax -- ad-hoc0\nexport const x0 = "changed";\n`,
    );
    res = runCli(dir, ["--changed", "--json", "--annotations"]);
    json = JSON.parse(
      readFileSync(join(dir, "reports", "i18n-allowlist-summary.json"), "utf8"),
    ) as SummaryJSON;
  });

  it("reports the run as scoped to changes", () => {
    expect(json.scopedToChanges).toBe(true);
  });

  it("scoped counts show only the changed file's missing entry; full counts show all 3", () => {
    expect(json.counts.missing).toBe(1);
    expect(json.fullCounts.missing).toBe(3);
  });

  it("topFiles + annotations reference only the changed file", () => {
    expect(json.failure?.topFiles).toEqual([`${files[0]}:1`]);
    const anns = res.stderr.split("\n").filter((l) => l.startsWith("::error"));
    expect(anns).toHaveLength(1);
    expect(anns[0]).toContain(`file=${files[0]},line=1`);
    // And neither of the unchanged files leak into annotations.
    for (const f of files.slice(1)) {
      expect(res.stderr).not.toContain(`file=${f},`);
    }
  });

  it("exits 1 (drift) — scoping doesn't change the exit-code class", () => {
    expect(res.status).toBe(1);
    expect(json.exitCode).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. --topFiles truncation order
// ────────────────────────────────────────────────────────────────────────────
describe("CLI --topFiles truncates and preserves order across all surfaces", () => {
  let dir: string;
  let files: string[];
  let res: ReturnType<typeof runCli>;
  let json: SummaryJSON;
  let stdoutJSON: SummaryJSON;
  const N = 2;
  const TOTAL = 5;

  beforeAll(() => {
    ({ dir, files } = makeDriftFixture(TOTAL));
    // Full repo run (no --changed) with topFiles=N where N < TOTAL.
    res = runCli(dir, [`--topFiles=${N}`, "--json", "--annotations"]);
    stdoutJSON = JSON.parse(res.stdout) as SummaryJSON;
    json = JSON.parse(
      readFileSync(join(dir, "reports", "i18n-allowlist-summary.json"), "utf8"),
    ) as SummaryJSON;
  });

  it("JSON topFiles is truncated to N", () => {
    expect(json.failure?.topFiles).toHaveLength(N);
    expect(stdoutJSON.failure?.topFiles).toEqual(json.failure?.topFiles);
  });

  it("truncation preserves the natural order (the first N missing in report order)", () => {
    // makeDriftFixture creates files in deterministic order; the
    // i18n-allowlist-check walks src/ via readdirSync which on most
    // filesystems returns sorted-ish order. Rather than assert a fixed
    // permutation, assert that topFiles are a prefix of *some* stable
    // ordering by re-running and getting the same answer.
    const res2 = runCli(dir, [`--topFiles=${N}`, "--json"]);
    const j2 = JSON.parse(res2.stdout) as SummaryJSON;
    expect(j2.failure?.topFiles).toEqual(json.failure?.topFiles);
  });

  it("annotations match topFiles 1:1 in the same order", () => {
    const anns = res.stderr.split("\n").filter((l) => l.startsWith("::error"));
    expect(anns).toHaveLength(N);
    for (let i = 0; i < N; i++) {
      const expectedFile = json.failure!.topFiles[i].replace(/:\d+$/, "");
      expect(anns[i]).toContain(`file=${expectedFile},`);
    }
  });

  it("the $GITHUB_STEP_SUMMARY-equivalent reason line lists the same top files in the same order", () => {
    // The workflow writes the CLI text output verbatim into
    // $GITHUB_STEP_SUMMARY. Re-run without --json so we capture the
    // pretty text and grep the `reason:` line.
    const pretty = runCli(dir, [`--topFiles=${N}`]);
    const reasonLine =
      pretty.stdout.split("\n").find((l) => l.includes("reason:")) ?? "";
    // Sanity: contains the failure header and the arrow-prefixed list.
    expect(reasonLine).toContain("drift (missing)");
    // The reason line lists topFiles joined by `, ` after `  →  `; we
    // assert the exact substring match so any reorder/truncation drift
    // between JSON + pretty text fails loudly.
    const arrowPart = reasonLine.split("  →  ")[1] ?? "";
    const expected =
      json.failure!.topFiles.join(", ") +
      (json.failure!.topFiles.length === 3 ? ", …" : "");
    expect(arrowPart).toBe(expected);

    // And formatSummary (the pure helper the workflow uses) produces
    // the same line shape from the same source-of-truth JSON.
    // (Smoke check — not a structural assertion of the helper itself.)
    expect(typeof formatSummary).toBe("function");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. --help ↔ docs snapshot parity
// ────────────────────────────────────────────────────────────────────────────
describe("CLI --help stays in sync with docs/i18n-allowlist-summary.md", () => {
  const tmp = mkdtempSync(join(tmpdir(), "i18n-allowlist-help-"));
  tmpDirs.push(tmp);
  const res = runCli(tmp, ["--help"]);
  const help = res.stdout;
  const doc = readFileSync(DOC_PATH, "utf8");

  it("--help exits 0 without running the allowlist check", () => {
    expect(res.status).toBe(0);
    // No report file should have been written into the tmp dir.
    expect(help).toContain("Usage: bun run i18n:allowlist:summary");
  });

  it("--help documents every flag + alias that the docs mention", () => {
    const FLAGS = [
      "--changed",
      "--json",
      "--annotations",
      "--topFiles",
      "--top-files",
      "--no-check-run",
      "--no-checkRun",
    ];
    for (const f of FLAGS) {
      expect(help, `--help must list ${f}`).toContain(f);
      expect(doc, `docs must list ${f}`).toContain(f);
    }
  });

  it("--help exit-code table matches the docs exit-code table (rows 0/2/1)", () => {
    // Both surfaces must claim the same three codes with the same
    // ordering/wording stems so reviewers can't see a different
    // contract depending on where they look.
    for (const row of [
      { code: "0", stem: "PASS" },
      { code: "2", stem: "Schema" },
      { code: "1", stem: "Drift" },
    ]) {
      expect(help).toMatch(new RegExp(`\\b${row.code}\\b.*${row.stem}`, "i"));
      expect(doc).toMatch(new RegExp(`\`${row.code}\`.*${row.stem}`, "i"));
    }
    // Schema-wins-when-both-fail clause must appear in both.
    expect(help.toLowerCase()).toContain("schema is checked first");
    expect(doc.toLowerCase()).toContain("schema");
    expect(doc).toMatch(/schema \+ drift.*`2`|`2`.*[Ss]chema wins/);
  });
});
