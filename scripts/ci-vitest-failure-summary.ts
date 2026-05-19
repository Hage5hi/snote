// Parse a vitest text-reporter log and emit a concise GitHub-flavoured
// markdown breakdown of failing tests (suite → test name → main diff)
// suitable for piping into $GITHUB_STEP_SUMMARY. Optionally also emits
// a machine-readable JSON version of the same breakdown so downstream
// tooling (PR bots, dashboards, debug bundles) can consume it directly.
//
// Tolerant to reporter / verbosity variations:
//   • Default reporter:    " FAIL  path/to/foo.test.ts > suite > name"
//   • Verbose reporter:    " × path/to/foo.test.ts > suite > name 12ms"
//   • Unicode marker:      " ✖ path/to/foo.test.ts > suite > name"
//   • Two-line form:       " ❯ path/to/foo.test.ts (...)" then
//                            "   × test name 12ms" indented underneath
//   • CRLF logs:           Windows runners' captured stdout
//   • CI mode prefixes:    leading " ❯ ", " - ", " > " on continuation
//
// Usage:
//   bun run scripts/ci-vitest-failure-summary.ts <log-file> [--json <out>]
//
// Always exits 0 — this is a reporting helper, not a gate.
import { readFileSync, writeFileSync } from "node:fs";

export interface Failure {
  file: string;
  test: string;
  diff: string[];
}

const HEADER_WITH_PATH: RegExp[] = [
  /^\s*(?:(?:×|✖|❯|FAIL|✗)\s+)?(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s*>\s*(.+?)\s*(?:\d+ms)?\s*$/,
  /^\s*FAIL\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s*>\s*(.+?)\s*$/,
];
const FILE_HEADER = /^\s*(?:❯|FAIL)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b/;
const FAILED_TEST_ROW = /^\s*(?:×|✖|✗)\s+(.+?)(?:\s+\d+ms)?\s*$/;
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

/** Strip ANSI colour codes + normalize line endings so regexes match cleanly. */
export function normalizeLog(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/**
 * Parse a (already-read) vitest log into a list of failures. Exported for
 * unit tests against synthetic reporter outputs.
 */
export function parseVitestLog(raw: string): Failure[] {
  const text = normalizeLog(raw);
  const lines = text.split("\n");

  const failures: Failure[] = [];
  const seen = new Set<string>();
  let current: Failure | null = null;
  let currentFile: string | null = null;

  const pushCurrent = () => {
    if (!current) return;
    const key = `${current.file}::${current.test}`;
    if (!seen.has(key)) {
      seen.add(key);
      failures.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    const fileHeader = FILE_HEADER.exec(line);
    if (fileHeader) currentFile = fileHeader[1];

    const header = matchHeaderWithPath(line);
    if (header) {
      pushCurrent();
      current = { file: header.file, test: header.test, diff: [] };
      continue;
    }

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
  return failures;
}

/** Trim/collapse a failure's captured diff lines into a single block. */
export function formatDiff(diff: string[]): string {
  return diff
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Group failures by suite file. */
export function groupBySuite(failures: Failure[]): Map<string, Failure[]> {
  const bySuite = new Map<string, Failure[]>();
  for (const f of failures) {
    const arr = bySuite.get(f.file) ?? [];
    arr.push(f);
    bySuite.set(f.file, arr);
  }
  return bySuite;
}

/** Render the markdown breakdown. */
export function renderMarkdown(failures: Failure[]): string {
  if (failures.length === 0) return "_No failing tests detected in vitest output._";
  const bySuite = groupBySuite(failures);
  const out: string[] = [];
  out.push(
    `**${failures.length} failing test${failures.length === 1 ? "" : "s"} across ${bySuite.size} suite${bySuite.size === 1 ? "" : "s"}**`,
  );
  out.push("");
  for (const [suite, fs] of bySuite) {
    out.push(`### \`${suite}\``);
    for (const f of fs) {
      out.push(`- **${f.test}**`);
      const diff = formatDiff(f.diff);
      if (diff) {
        out.push("");
        out.push("```diff");
        out.push(diff);
        out.push("```");
      }
    }
    out.push("");
  }
  return out.join("\n");
}

/** Render the JSON breakdown — flat shape, easy to consume from bots. */
export function renderJson(failures: Failure[]): string {
  const payload = {
    failureCount: failures.length,
    suiteCount: new Set(failures.map((f) => f.file)).size,
    failures: failures.map((f) => ({
      suite: f.file,
      test: f.test,
      diff: formatDiff(f.diff),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

// ────────────────────────────────────────────────────────────────────────────
// CLI entry — only runs when invoked directly, so unit tests can import the
// helpers above without triggering process.exit / file IO.
// ────────────────────────────────────────────────────────────────────────────
const invokedDirectly = (() => {
  try {
    const arg = process.argv[1] ?? "";
    return arg.endsWith("ci-vitest-failure-summary.ts") || arg.endsWith("ci-vitest-failure-summary.js");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const logPath = args.find((a) => !a.startsWith("--"));
  const jsonIdx = args.indexOf("--json");
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;

  if (!logPath) {
    console.error("usage: ci-vitest-failure-summary <log-file> [--json <out>]");
    process.exit(0);
  }

  let raw = "";
  try {
    raw = readFileSync(logPath, "utf8");
  } catch (e) {
    console.log(`_failure-summary: unable to read ${logPath} (${(e as Error).message})_`);
    process.exit(0);
  }

  const failures = parseVitestLog(raw);
  console.log(renderMarkdown(failures));
  if (jsonOut) {
    try {
      writeFileSync(jsonOut, renderJson(failures));
    } catch (e) {
      console.error(`_failure-summary: unable to write JSON to ${jsonOut} (${(e as Error).message})_`);
    }
  }
}
