// CLI integration coverage that complements i18n-allowlist-cli-flags.test.ts:
//
//   1. Cross-platform path handling — when --changed receives Windows-style
//      paths (backslash separators), truncation order and the resulting
//      topFiles list match what we'd get from the equivalent POSIX paths.
//   2. Edge values for --topFiles (0, 1, negative, non-numeric) — invalid
//      values clamp to the documented default (3); N=1 truncates to one;
//      the CLI still exits with the drift code (1) regardless of N.
//   3. Three-way parity — SummaryJSON (stdout), the on-disk summary
//      artifact, and stderr `::error` annotations all list the same
//      ordered, truncated topFiles for every flag combination
//      (--changed, --topFiles N, --no-check-run).
//
// Re-uses the tmpdir + fake-git shim pattern from the sibling CLI tests.
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
import {
  buildSummary,
  parseTopFilesArg,
  type AllowlistReport,
  type SummaryJSON,
} from "../i18n-allowlist-report";

const PROJECT_ROOT = process.cwd();
const CLI_PATH = resolve(PROJECT_ROOT, "scripts/i18n-allowlist-report.ts");
const SCHEMA_SRC = resolve(PROJECT_ROOT, ".lintrc-i18n-allowlist.schema.json");

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function runCli(cwd: string, args: string[], pathPrefix?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "" };
  if (pathPrefix) env.PATH = `${pathPrefix}${delimiter}${process.env.PATH ?? ""}`;
  const r = spawnSync("bun", ["run", CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function makeDriftFixture(fileCount: number): { dir: string; files: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "i18n-allowlist-parity-"));
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

function makeFakeGit(changedNames: string[]): string {
  const binDir = mkdtempSync(join(tmpdir(), "fake-git-parity-"));
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

function annotationsFromStderr(stderr: string): string[] {
  return stderr.split("\n").filter((l) => l.startsWith("::error"));
}

function annotationFiles(anns: string[]): string[] {
  return anns.map((a) => {
    const m = a.match(/file=([^,:]+)(?:,line=(\d+))?/);
    if (!m) return "";
    return m[2] ? `${m[1]}:${m[2]}` : m[1];
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Cross-platform path handling (Windows-style separators)
// ────────────────────────────────────────────────────────────────────────────
describe("buildSummary normalizes Windows-style paths for --changed scoping", () => {
  // Synthetic AllowlistReport with drift across 4 source files. Lets us
  // exercise the buildSummary helper directly without depending on a
  // Windows CI runner being available.
  const report: AllowlistReport = {
    ok: false,
    schemaOk: true,
    driftOk: false,
    totals: { entries: 0, schemaErrors: 0, missing: 4, stale: 0 },
    entries: [],
    missing: [
      { file: "src/a.tsx", reason: "no-restricted-syntax", line: 10 },
      { file: "src/b.tsx", reason: "no-restricted-syntax", line: 20 },
      { file: "src/c.tsx", reason: "no-restricted-syntax", line: 30 },
      { file: "src/d.tsx", reason: "no-restricted-syntax", line: 40 },
    ],
    stale: [],
  };

  it("backslash and forward-slash inputs produce identical topFiles ordering + truncation", () => {
    const posix = ["src/a.tsx", "src/b.tsx", "src/c.tsx"];
    const win = posix.map((p) => p.replaceAll("/", "\\"));

    const sPosix = buildSummary(report, "reports/i18n-allowlist-report.json", {
      changed: posix,
      topN: 2,
    });
    const sWin = buildSummary(report, "reports/i18n-allowlist-report.json", {
      changed: win,
      topN: 2,
    });

    expect(sWin.failure?.topFiles).toEqual(sPosix.failure?.topFiles);
    expect(sWin.failure?.topFiles).toHaveLength(2);
    // Forward slashes survive even when input had backslashes.
    for (const f of sWin.failure!.topFiles) expect(f).not.toContain("\\");
    // Truncation kept us inside the scoped set.
    expect(sWin.failure!.topFiles.every((f) => f.startsWith("src/"))).toBe(true);
  });

  it("mixed-separator changed list still scopes correctly and preserves order", () => {
    const mixed = ["src\\a.tsx", "src/b.tsx", "src\\c.tsx"];
    const s = buildSummary(report, "reports/i18n-allowlist-report.json", {
      changed: mixed,
      topN: 3,
    });
    expect(s.scopedToChanges).toBe(true);
    expect(s.missingCount).toBe(3);
    expect(s.failure?.topFiles).toEqual([
      "src/a.tsx:10",
      "src/b.tsx:20",
      "src/c.tsx:30",
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. --topFiles edge values (0, 1, negative, non-numeric)
// ────────────────────────────────────────────────────────────────────────────
describe("parseTopFilesArg clamps edge / invalid values to the default", () => {
  for (const raw of ["0", "-1", "-99", "abc", ""]) {
    it(`'${raw}' falls back to the default (3)`, () => {
      expect(parseTopFilesArg(["--topFiles", raw])).toBe(3);
      expect(parseTopFilesArg([`--topFiles=${raw}`])).toBe(3);
    });
  }
  it("'1' is honored as the minimum legal value", () => {
    expect(parseTopFilesArg(["--topFiles", "1"])).toBe(1);
  });
  it("large integer is honored verbatim", () => {
    expect(parseTopFilesArg(["--topFiles", "42"])).toBe(42);
  });
});

describe("CLI honors --topFiles edge values end-to-end", () => {
  it("--topFiles 0 falls back to the default (3) and still exits 1 for drift", () => {
    const { dir } = makeDriftFixture(5);
    const r = runCli(dir, ["--topFiles", "0", "--json"]);
    const j = JSON.parse(r.stdout) as SummaryJSON;
    expect(r.status).toBe(1);
    expect(j.failure?.topFiles).toHaveLength(3);
  });

  it("--topFiles 1 truncates to exactly one file and exits 1 for drift", () => {
    const { dir } = makeDriftFixture(5);
    const r = runCli(dir, ["--topFiles", "1", "--json", "--annotations"]);
    const j = JSON.parse(r.stdout) as SummaryJSON;
    expect(r.status).toBe(1);
    expect(j.failure?.topFiles).toHaveLength(1);
    expect(annotationsFromStderr(r.stderr)).toHaveLength(1);
  });

  it("--topFiles -3 falls back to the default (3) and exits 1 for drift", () => {
    const { dir } = makeDriftFixture(5);
    const r = runCli(dir, ["--topFiles", "-3", "--json"]);
    const j = JSON.parse(r.stdout) as SummaryJSON;
    expect(r.status).toBe(1);
    expect(j.failure?.topFiles).toHaveLength(3);
  });

  it("--topFiles abc (non-numeric) falls back to default and exits 1 for drift", () => {
    const { dir } = makeDriftFixture(5);
    const r = runCli(dir, ["--topFiles", "abc", "--json"]);
    const j = JSON.parse(r.stdout) as SummaryJSON;
    expect(r.status).toBe(1);
    expect(j.failure?.topFiles).toHaveLength(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Three-way parity: SummaryJSON / artifact / annotations match exactly
// ────────────────────────────────────────────────────────────────────────────
describe("SummaryJSON, written artifact, and stderr annotations agree on topFiles", () => {
  type Combo = { label: string; extra: string[]; expectN: number; changed?: number };
  const COMBOS: Combo[] = [
    { label: "plain",                              extra: ["--topFiles=2"],                       expectN: 2 },
    { label: "--no-check-run",                     extra: ["--no-check-run", "--topFiles=2"],     expectN: 2 },
    { label: "--no-checkRun alias",                extra: ["--no-checkRun", "--topFiles=3"],      expectN: 3 },
    { label: "--changed + --topFiles",             extra: ["--changed", "--topFiles=2"],          expectN: 2, changed: 4 },
    { label: "--changed + --topFiles + no-check-run", extra: ["--changed", "--topFiles=2", "--no-check-run"], expectN: 2, changed: 4 },
  ];

  for (const combo of COMBOS) {
    // --changed combos rely on a POSIX `#!/bin/sh` git shim that doesn't
    // execute on Windows runners. Cross-platform path coverage there is
    // provided by the buildSummary unit tests above; the non-`--changed`
    // combos still run on Windows to keep three-surface parity covered.
    const test = combo.changed && process.platform === "win32" ? it.skip : it;
    test(`combo: ${combo.label} → identical ordered topFiles across all 3 surfaces`, () => {
      const { dir, files } = makeDriftFixture(5);
      const pathPrefix = combo.changed
        ? makeFakeGit(files.slice(0, combo.changed))
        : undefined;
      const r = runCli(dir, [...combo.extra, "--json", "--annotations"], pathPrefix);
      const stdoutJson = JSON.parse(r.stdout) as SummaryJSON;
      const artifactJson = JSON.parse(
        readFileSync(join(dir, "reports", "i18n-allowlist-summary.json"), "utf8"),
      ) as SummaryJSON;
      const annFiles = annotationFiles(annotationsFromStderr(r.stderr));

      // (a) stdout and on-disk artifact agree on everything that matters.
      expect(artifactJson.failure?.topFiles).toEqual(stdoutJson.failure?.topFiles);
      expect(artifactJson.publishCheckRun).toBe(stdoutJson.publishCheckRun);
      expect(artifactJson.exitCode).toBe(stdoutJson.exitCode);

      // (b) annotations list the same files, in the same order.
      expect(annFiles).toEqual(stdoutJson.failure?.topFiles);

      // (c) truncation respected the requested N.
      expect(stdoutJson.failure?.topFiles).toHaveLength(combo.expectN);
    });
  }
});
