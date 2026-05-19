// Parse a vitest text-reporter log and emit a concise GitHub-flavoured
// markdown breakdown of failing tests (suite → test name → main diff)
// suitable for piping into $GITHUB_STEP_SUMMARY.
//
// Tolerant to reporter / verbosity variations:
//   • Default reporter:    " FAIL  path/to/foo.test.ts > suite > name"
//   • Verbose reporter:    " × path/to/foo.test.ts > suite > name 12ms"
//   • Unicode marker:      " ✖ path/to/foo.test.ts > suite > name"
//   • Failed-tests summary:" ⎯⎯⎯ Failed Tests N ⎯⎯⎯" block with
//                            " FAIL ... > ..." entries (newer vitest)
//   • CI mode prefixes:    leading " ❯ ", " - ", " > " on continuation
//
// Always exits 0 — this is a reporting helper, not a gate.
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: ci-vitest-failure-summary <log-file>");
  process.exit(0);
}

let raw = "";
try {
  raw = readFileSync(path, "utf8");
} catch (e) {
  console.log(`_failure-summary: unable to read ${path} (${(e as Error).message})_`);
  process.exit(0);
}

// Strip ANSI colour codes + normalize line endings so regexes match cleanly.
const text = raw
  .replace(/\x1b\[[0-9;]*m/g, "")
  .replace(/\r\n/g, "\n")
  .replace(/\r/g, "\n");
const lines = text.split("\n");

interface Failure {
  file: string;
  test: string;
  diff: string[];
}

// Two-shape support:
//   (A) one-liner with the path:  "FAIL path/foo.test.ts > suite > name"
//   (B) two-line: a "❯ path/foo.test.ts (... failed)" header followed by
//       indented "× test name 12ms" rows. We remember the most-recent
//       file path so the per-test row resolves against it.
const HEADER_WITH_PATH: RegExp[] = [
  /^\s*(?:(?:×|✖|❯|FAIL|✗)\s+)?(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s*>\s*(.+?)\s*(?:\d+ms)?\s*$/,
  /^\s*FAIL\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s*>\s*(.+?)\s*$/,
];
const FILE_HEADER = /^\s*(?:❯|FAIL)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b/;
const FAILED_TEST_ROW = /^\s*(?:×|✖|✗)\s+(.+?)(?:\s+\d+ms)?\s*$/;

// Lines that mean "end of this failure's diff context".
const TERMINATORS =
  /^(?:\s*(?:✓|PASS|RUN|Test Files|Tests|Errors|Snapshots|Duration|Start at|Coverage report)\b|⎯{3,}|={3,})/;

const MAX_DIFF_LINES = 25;

function matchHeaderWithPath(line: string): { file: string; test: string } | null {
  for (const re of HEADER_WITH_PATH) {
    const m = re.exec(line);
    if (m) return { file: m[1], test: m[2].trim() };
  }
  return null;
}

const failures: Failure[] = [];
const seen = new Set<string>();
let current: Failure | null = null;

const pushCurrent = () => {
  if (!current) return;
  const key = `${current.file}::${current.test}`;
  if (!seen.has(key)) {
    seen.add(key);
    failures.push(current);
  }
  current = null;
};

let currentFile: string | null = null;

for (const line of lines) {
  // Track the most-recent file-level header so two-line failure rows
  // (e.g. "× test name 12ms" indented under "❯ path/foo.test.ts") can
  // attribute themselves.
  const fileHeader = FILE_HEADER.exec(line);
  if (fileHeader) currentFile = fileHeader[1];

  const header = matchHeaderWithPath(line);
  if (header) {
    pushCurrent();
    current = { file: header.file, test: header.test, diff: [] };
    continue;
  }

  // Two-line form: "× test name" under a prior "❯ path/foo.test.ts" header.
  const row = FAILED_TEST_ROW.exec(line);
  if (row && currentFile && !matchHeaderWithPath(line)) {
    pushCurrent();
    current = { file: currentFile, test: row[1].trim(), diff: [] };
    continue;
  }

  if (current) {
    if (TERMINATORS.test(line)) {
      pushCurrent();
      continue;
    }
    if (current.diff.length < MAX_DIFF_LINES) current.diff.push(line);
  }
}
pushCurrent();

if (failures.length === 0) {
  console.log("_No failing tests detected in vitest output._");
  process.exit(0);
}

// Group by suite file so reviewers see "which suite" at a glance.
const bySuite = new Map<string, Failure[]>();
for (const f of failures) {
  const arr = bySuite.get(f.file) ?? [];
  arr.push(f);
  bySuite.set(f.file, arr);
}

const out: string[] = [];
out.push(
  `**${failures.length} failing test${failures.length === 1 ? "" : "s"} across ${bySuite.size} suite${bySuite.size === 1 ? "" : "s"}**`,
);
out.push("");
for (const [suite, fs] of bySuite) {
  out.push(`### \`${suite}\``);
  for (const f of fs) {
    out.push(`- **${f.test}**`);
    // Trim leading/trailing blank lines from the diff, collapse runs of
    // blank lines, and keep only the meaningful chunk.
    const diff = f.diff
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (diff) {
      out.push("");
      out.push("```diff");
      out.push(diff);
      out.push("```");
    }
  }
  out.push("");
}
console.log(out.join("\n"));
