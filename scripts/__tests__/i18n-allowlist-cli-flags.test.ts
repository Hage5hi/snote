// Additional CLI integration coverage focused on flag interactions:
//
//   1. `--changed` + `--topFiles N` (N < changed-set size): truncation
//      stays inside the scoped diff — never bleeds into unchanged files.
//   2. `--no-check-run` (and its `--no-checkRun` alias) flip
//      `publishCheckRun:false` on SummaryJSON while still writing the
//      summary artifact and emitting `::error` annotations to stderr.
//   3. `--help` lists every documented alias (`--top-files` vs
//      `--topFiles`, etc.) and each alias is accepted by the CLI without
//      changing the resulting SummaryJSON or exit code.
//   4. The ordered list of file paths in the stderr annotations matches
//      the ordered list rendered in the `reason:` line of the
//      $GITHUB_STEP_SUMMARY-equivalent CLI output, including truncation.
//
// Mirrors the scoping test's tmpdir + fake-git shim pattern.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HELP_TEXT, type SummaryJSON } from "../i18n-allowlist-report";

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
  const r = spawnSync("bun", ["run", CLI_PATH, ...args], { cwd, encoding: "utf8", env });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function makeDriftFixture(fileCount: number): { dir: string; files: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "i18n-allowlist-flags-"));
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
// 1. --changed + --topFiles: truncation stays inside the scoped set
// ────────────────────────────────────────────────────────────────────────────
describe("CLI --changed + --topFiles truncates only within the changed-entry set", () => {
  let dir: string;
  let files: string[];
  let res: ReturnType<typeof runCli>;
  let json: SummaryJSON;
  const TOTAL = 5;
  const CHANGED_COUNT = 3;
  const N = 2;

  beforeAll(() => {
    ({ dir, files } = makeDriftFixture(TOTAL));
    const changed = files.slice(0, CHANGED_COUNT);
    const fakeGitBin = makeFakeGit(changed);
    res = runCli(
      dir,
      ["--changed", `--topFiles=${N}`, "--json", "--annotations"],
      fakeGitBin,
    );
    json = JSON.parse(
      readFileSync(join(dir, "reports", "i18n-allowlist-summary.json"), "utf8"),
    ) as SummaryJSON;
  });

  it("is scoped to changes and counts only the changed file's drift", () => {
    expect(json.scopedToChanges).toBe(true);
    expect(json.counts.missing).toBe(CHANGED_COUNT);
    expect(json.fullCounts.missing).toBe(TOTAL);
  });

  it("topFiles is truncated to N and only references changed files", () => {
    expect(json.failure?.topFiles).toHaveLength(N);
    const changedSet = new Set(files.slice(0, CHANGED_COUNT));
    for (const tf of json.failure!.topFiles) {
      const f = tf.replace(/:\d+$/, "");
      expect(changedSet.has(f)).toBe(true);
    }
    // None of the unchanged files leak into topFiles.
    for (const unchanged of files.slice(CHANGED_COUNT)) {
      expect(json.failure!.topFiles.some((tf) => tf.startsWith(unchanged))).toBe(false);
    }
  });

  it("annotations are truncated to N and reference only changed files", () => {
    const anns = annotationsFromStderr(res.stderr);
    expect(anns).toHaveLength(N);
    for (const unchanged of files.slice(CHANGED_COUNT)) {
      expect(res.stderr).not.toContain(`file=${unchanged},`);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. --no-check-run and --no-checkRun: publishCheckRun=false, artifacts+anns kept
// ────────────────────────────────────────────────────────────────────────────
describe("CLI --no-check-run / --no-checkRun disable Check Run only", () => {
  for (const flag of ["--no-check-run", "--no-checkRun"]) {
    describe(`flag: ${flag}`, () => {
      let dir: string;
      let res: ReturnType<typeof runCli>;
      let json: SummaryJSON;
      let artifact: SummaryJSON;

      beforeAll(() => {
        ({ dir } = makeDriftFixture(2));
        res = runCli(dir, [flag, "--json", "--annotations"]);
        json = JSON.parse(res.stdout) as SummaryJSON;
        artifact = JSON.parse(
          readFileSync(join(dir, "reports", "i18n-allowlist-summary.json"), "utf8"),
        ) as SummaryJSON;
      });

      it("sets publishCheckRun:false on both stdout JSON and artifact", () => {
        expect(json.publishCheckRun).toBe(false);
        expect(artifact.publishCheckRun).toBe(false);
      });

      it("still writes the summary artifact to disk", () => {
        expect(existsSync(join(dir, "reports", "i18n-allowlist-summary.json"))).toBe(true);
      });

      it("still emits annotations to stderr", () => {
        const anns = annotationsFromStderr(res.stderr);
        expect(anns.length).toBeGreaterThan(0);
      });
    });
  }

  it("both aliases yield identical SummaryJSON (modulo publishCheckRun=false in both)", () => {
    const a = makeDriftFixture(2);
    const b = makeDriftFixture(2);
    const ra = runCli(a.dir, ["--no-check-run", "--json"]);
    const rb = runCli(b.dir, ["--no-checkRun", "--json"]);
    const ja = JSON.parse(ra.stdout) as SummaryJSON;
    const jb = JSON.parse(rb.stdout) as SummaryJSON;
    expect(ja.publishCheckRun).toBe(false);
    expect(jb.publishCheckRun).toBe(false);
    expect(ra.status).toBe(rb.status);
    // Drop the reportPath which is cwd-relative-stable but identical in shape.
    expect({ ...ja, reportPath: "" }).toEqual({ ...jb, reportPath: "" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. --help lists every alias variant + each alias is accepted
// ────────────────────────────────────────────────────────────────────────────
describe("CLI --help documents every alias variant and accepts each one", () => {
  const ALIAS_GROUPS: { canonical: string; aliases: string[] }[] = [
    { canonical: "--topFiles", aliases: ["--top-files", "--topFiles=N", "--top-files=N"] },
    { canonical: "--no-check-run", aliases: ["--no-checkRun"] },
  ];

  it("HELP_TEXT lists every alias variant alongside its canonical form", () => {
    for (const g of ALIAS_GROUPS) {
      expect(HELP_TEXT).toContain(g.canonical);
      for (const a of g.aliases) {
        expect(HELP_TEXT, `HELP_TEXT must list alias ${a}`).toContain(a);
      }
    }
  });

  it("--topFiles and --top-files (and =N forms) all produce the same SummaryJSON + exit code", () => {
    const variants: { label: string; args: string[] }[] = [
      { label: "topFiles N",     args: ["--topFiles", "2", "--json"] },
      { label: "top-files N",    args: ["--top-files", "2", "--json"] },
      { label: "topFiles=N",     args: ["--topFiles=2", "--json"] },
      { label: "top-files=N",    args: ["--top-files=2", "--json"] },
    ];
    const results = variants.map((v) => {
      const { dir } = makeDriftFixture(4);
      const r = runCli(dir, v.args);
      return { ...v, status: r.status, json: JSON.parse(r.stdout) as SummaryJSON };
    });
    const baseline = { ...results[0].json, reportPath: "" };
    for (const r of results.slice(1)) {
      expect(r.status, `${r.label} exit code`).toBe(results[0].status);
      expect({ ...r.json, reportPath: "" }, `${r.label} JSON parity`).toEqual(baseline);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. annotation order == reason-line order, including truncation
// ────────────────────────────────────────────────────────────────────────────
describe("CLI annotations stderr order matches the reason: line order (with truncation)", () => {
  it("ordered annotation files == ordered files in `reason:` arrow suffix", () => {
    const { dir } = makeDriftFixture(5);
    // Pretty run gives us the `reason:` line; annotations come from a
    // second run with --annotations. Both use the same topFiles N so the
    // order is directly comparable.
    const pretty = runCli(dir, ["--topFiles=2"]);
    const annsRun = runCli(dir, ["--topFiles=2", "--annotations"]);

    const reasonLine =
      pretty.stdout.split("\n").find((l) => l.includes("reason:")) ?? "";
    const arrowPart = (reasonLine.split("  →  ")[1] ?? "").replace(/, …$/, "");
    const reasonFiles = arrowPart.split(", ").filter(Boolean);

    const annFiles = annotationFiles(annotationsFromStderr(annsRun.stderr));
    expect(annFiles).toEqual(reasonFiles);
    expect(annFiles.length).toBe(2); // truncated to topFiles=2
  });

  it("when topFiles >= total failures, reason files and annotations both list everything in the same order", () => {
    const { dir } = makeDriftFixture(2);
    const pretty = runCli(dir, ["--topFiles=5"]);
    const annsRun = runCli(dir, ["--topFiles=5", "--annotations"]);
    const reasonLine =
      pretty.stdout.split("\n").find((l) => l.includes("reason:")) ?? "";
    const reasonFiles = (reasonLine.split("  →  ")[1] ?? "")
      .replace(/, …$/, "")
      .split(", ")
      .filter(Boolean);
    const annFiles = annotationFiles(annotationsFromStderr(annsRun.stderr));
    expect(annFiles).toEqual(reasonFiles);
    expect(annFiles.length).toBe(2);
  });
});
