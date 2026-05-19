// CLI-level tests that need real scoping, real truncation, and a
// snapshot of the --help text against the documentation. These spawn
// the actual CLI in throwaway working directories.
//
// `git` is mocked via a tiny shell shim on PATH (the sandbox blocks
// `git add`/`git commit`, and we only care about what `getChangedFiles`
// observes — not real history).
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
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
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

function runCli(cwd: string, args: string[], pathPrefix?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "" };
  if (pathPrefix) env.PATH = `${pathPrefix}${delimiter}${process.env.PATH ?? ""}`;
  const r = spawnSync("bun", ["run", CLI_PATH, ...args], { cwd, encoding: "utf8", env });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Build a tmp project with N unallowlisted disables, each in its own
 * file (`src/file<i>.tsx`). The allowlist is empty so every disable
 * shows up as `missing`. No git: callers that need --changed scoping
 * use the fake-git shim below.
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
      `// eslint-disable-next-line no-restricted-syntax -- ad-hoc${i}\nexport const x${i} = "y";\n`,
    );
    files.push(rel);
  }
  return { dir, files };
}

/**
 * Create a tmp directory containing a `git` shell shim that reports
 * `changedNames` for `git diff --name-only HEAD` and empty for
 * `git ls-files --others`. The shim's parent dir is meant to be
 * prepended to PATH so `getChangedFiles` picks it up instead of the
 * real git binary.
 */
function makeFakeGit(changedNames: string[]): string {
  const binDir = mkdtempSync(join(tmpdir(), "fake-git-bin-"));
  tmpDirs.push(binDir);
  const body = [
    "#!/bin/sh",
    'if [ "$1" = "diff" ]; then',
    ...changedNames.map((n) => `  echo "${n}"`),
    "  exit 0",
    'elif [ "$1" = "ls-files" ]; then',
    "  exit 0",
    "fi",
    "exit 0",
  ].join("\n");
  const p = join(binDir, "git");
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return binDir;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. --changed integration (via fake-git shim)
// ────────────────────────────────────────────────────────────────────────────
describe("CLI --changed scopes counts + annotations to the diff", () => {
  let dir: string;
  let files: string[];
  let res: ReturnType<typeof runCli>;
  let json: SummaryJSON;

  beforeAll(() => {
    ({ dir, files } = makeDriftFixture(3));
    const fakeGitBin = makeFakeGit([files[0]]);
    res = runCli(dir, ["--changed", "--json", "--annotations"], fakeGitBin);
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
  let res: ReturnType<typeof runCli>;
  let json: SummaryJSON;
  let stdoutJSON: SummaryJSON;
  const N = 2;
  const TOTAL = 5;

  beforeAll(() => {
    ({ dir } = makeDriftFixture(TOTAL));
    res = runCli(dir, [`--topFiles=${N}`, "--json", "--annotations"]);
    stdoutJSON = JSON.parse(res.stdout) as SummaryJSON;
    json = JSON.parse(
      readFileSync(join(dir, "reports", "i18n-allowlist-summary.json"), "utf8"),
    ) as SummaryJSON;
  });

  it("JSON topFiles is truncated to N", () => {
    expect(json.failure?.topFiles).toHaveLength(N);
    expect(stdoutJSON.failure?.topFiles).toEqual(json.failure?.topFiles);
    expect(json.fullCounts.missing).toBe(TOTAL);
  });

  it("truncation is deterministic across re-runs (stable order)", () => {
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
    const pretty = runCli(dir, [`--topFiles=${N}`]);
    const reasonLine =
      pretty.stdout.split("\n").find((l) => l.includes("reason:")) ?? "";
    expect(reasonLine).toContain("drift (missing)");
    const arrowPart = reasonLine.split("  →  ")[1] ?? "";
    // The arrow-suffixed list mirrors topFiles exactly (no `, …` since
    // truncation only adds the ellipsis when the surfaced count is 3 —
    // see formatFailureReason). N=2 here, so the strings match 1:1.
    expect(arrowPart).toBe(json.failure!.topFiles.join(", "));
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
    expect(doc).toMatch(/schema \+ drift.*`2`|`2`.*[Ss]chema wins/);
  });

  // Committed --help snapshot: byte-for-byte parity against
  // scripts/__tests__/__snapshots__/cli-help.txt so any wording change
  // shows up as a reviewable diff. Both sides are normalized to LF +
  // stripped of a trailing newline so the snapshot is stable across
  // Windows (CRLF) and macOS/Linux (LF) runners. On mismatch we render
  // a unified-style line diff into the failure message AND drop it on
  // disk so the CI failure-artifact step can ship it. Refresh with:
  //   bun run scripts/i18n-allowlist-report.ts --help \
  //     > scripts/__tests__/__snapshots__/cli-help.txt
  it("--help output exactly matches the committed snapshot file", () => {
    const SNAPSHOT_PATH = resolve(
      PROJECT_ROOT,
      "scripts/__tests__/__snapshots__/cli-help.txt",
    );
    const norm = (s: string) => s.replace(/\r\n/g, "\n").replace(/\n+$/, "");
    const expected = norm(readFileSync(SNAPSHOT_PATH, "utf8"));
    const actual = norm(help);
    if (expected !== actual) {
      const diff = diffLines(expected, actual);
      try {
        mkdirSync(resolve(PROJECT_ROOT, "reports/_ci"), { recursive: true });
        writeFileSync(
          resolve(PROJECT_ROOT, "reports/_ci/help-snapshot.diff"),
          diff,
        );
      } catch {
        /* best-effort — CI artifact upload tolerates missing files */
      }
      throw new Error(
        [
          "--help output drifted from committed snapshot.",
          "Snapshot: scripts/__tests__/__snapshots__/cli-help.txt",
          "Refresh with:",
          "  bun run scripts/i18n-allowlist-report.ts --help \\",
          "    > scripts/__tests__/__snapshots__/cli-help.txt",
          "",
          "--- expected (snapshot)",
          "+++ actual (--help)",
          diff,
        ].join("\n"),
      );
    }
    expect(actual).toBe(expected);
  });
});

/**
 * Tiny line-oriented diff used by the --help snapshot assertion. We avoid
 * pulling in a `diff` dependency just for one test — a marker per line is
 * enough to localize the drift in CI logs.
 */
function diffLines(expected: string, actual: string): string {
  const e = expected.split("\n");
  const a = actual.split("\n");
  const max = Math.max(e.length, a.length);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    if (e[i] === a[i]) {
      out.push(`  ${e[i] ?? ""}`);
    } else {
      if (e[i] !== undefined) out.push(`- ${e[i]}`);
      if (a[i] !== undefined) out.push(`+ ${a[i]}`);
    }
  }
  return out.join("\n");
}
