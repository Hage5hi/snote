// Parse a vitest text-reporter log and emit a concise GitHub-flavoured
// markdown breakdown of failing tests (suite → test name → main diff)
// suitable for piping into $GITHUB_STEP_SUMMARY.
//
// Usage:
//   bun run scripts/ci-vitest-failure-summary.ts <log-file>
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

// Strip ANSI colour codes so regexes match cleanly.
const text = raw.replace(/\x1b\[[0-9;]*m/g, "");
const lines = text.split("\n");

interface Failure {
  file: string;
  test: string;
  diff: string[];
}

const failures: Failure[] = [];
let current: Failure | null = null;

// Vitest's default reporter emits failing-test blocks shaped like:
//   FAIL  scripts/__tests__/foo.test.ts > suite > test name
//   AssertionError: expected X to be Y
//      - expected
//      + actual
//      ...
// We capture the header line then keep ~20 lines of context until the
// next FAIL/PASS/summary marker. Truncation keeps the step summary
// readable when many tests fail at once.
const HEADER = /^\s*(?:×|✖|FAIL)\s+(\S+\.test\.tsx?)\s*>\s*(.+?)\s*$/;
const TERMINATORS = /^(?:\s*(?:✓|PASS|RUN|Test Files|Tests|Errors|Snapshots|Duration|Start at)\b|⎯{3,})/;
const MAX_DIFF_LINES = 20;

for (const line of lines) {
  const m = HEADER.exec(line);
  if (m) {
    if (current) failures.push(current);
    current = { file: m[1], test: m[2], diff: [] };
    continue;
  }
  if (current) {
    if (TERMINATORS.test(line) || HEADER.test(line)) {
      failures.push(current);
      current = null;
      continue;
    }
    if (current.diff.length < MAX_DIFF_LINES) current.diff.push(line);
  }
}
if (current) failures.push(current);

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
out.push(`**${failures.length} failing test${failures.length === 1 ? "" : "s"} across ${bySuite.size} suite${bySuite.size === 1 ? "" : "s"}**`);
out.push("");
for (const [suite, fs] of bySuite) {
  out.push(`### \`${suite}\``);
  for (const f of fs) {
    out.push(`- **${f.test}**`);
    const diff = f.diff.map((l) => l.replace(/^\s+$/, "")).join("\n").trim();
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
