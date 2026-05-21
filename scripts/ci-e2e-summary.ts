#!/usr/bin/env bun
// Parse Playwright's JSON reporter output and emit a concise markdown
// summary for $GITHUB_STEP_SUMMARY. Highlights failing specs with
// pixel-diff threshold metadata and direct links to the uploaded
// playwright-report / test-results artifacts.
//
// Usage:
//   bun run scripts/ci-e2e-summary.ts <playwright-results.json> \
//     --run-url <url> [--out summary.md] [--json summary.json]
//
// When the JSON file is missing OR contains no failures, exits 0 with a
// "no failures" message — never throws so CI summary always renders.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

type AttachmentRef = { name: string; path?: string; contentType?: string };
type TestResult = {
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  error?: { message?: string };
  attachments?: AttachmentRef[];
  retry?: number;
};
type TestEntry = { title: string; results: TestResult[]; projectName?: string };
type SpecEntry = { title: string; file: string; tests: TestEntry[] };
type SuiteEntry = { title?: string; specs?: SpecEntry[]; suites?: SuiteEntry[] };
type Report = { suites?: SuiteEntry[]; stats?: { duration?: number } };

interface Failure {
  file: string;
  spec: string;
  test: string;
  project: string;
  retry: number;
  message: string;
  pixelDiff?: string;       // parsed "ratio 0.012" if present
  attachments: AttachmentRef[];
}

function* walkSpecs(suites: SuiteEntry[] | undefined): Generator<SpecEntry> {
  if (!suites) return;
  for (const s of suites) {
    if (s.specs) for (const sp of s.specs) yield sp;
    if (s.suites) yield* walkSpecs(s.suites);
  }
}

function extractPixelDiff(msg: string): string | undefined {
  // Matches "ratio 0.012", "0.5% pixels differ", "12 pixels diff".
  const m = msg.match(/(?:ratio|threshold|maxDiffPixelRatio)[^\d]{0,8}([\d.]+)/i);
  if (m) return m[1];
  const pct = msg.match(/([\d.]+)\s*%\s*(?:of\s*)?pixels/i);
  if (pct) return `${pct[1]}%`;
  return undefined;
}

function parse(report: Report): Failure[] {
  const out: Failure[] = [];
  for (const spec of walkSpecs(report.suites)) {
    for (const t of spec.tests) {
      // Pick the worst result (last retry usually).
      const last = t.results[t.results.length - 1];
      if (!last) continue;
      if (last.status === "passed" || last.status === "skipped") continue;
      const msg = last.error?.message ?? "(no message)";
      out.push({
        file: spec.file,
        spec: spec.title,
        test: t.title,
        project: t.projectName ?? "default",
        retry: last.retry ?? 0,
        message: msg.split("\n").slice(0, 4).join(" ").slice(0, 300),
        pixelDiff: extractPixelDiff(msg),
        attachments: last.attachments ?? [],
      });
    }
  }
  return out;
}

function fmtMd(failures: Failure[], runUrl: string): string {
  if (failures.length === 0) {
    return "### Playwright E2E — all green\n\nNo failing tests in this run.\n";
  }
  const lines = [
    `### Playwright E2E — ${failures.length} failing test(s)`,
    "",
    `Download artifacts: [open run artifacts](${runUrl})`,
    "",
    "| Project | Spec → Test | Retry | Pixel diff | Attachments |",
    "|---|---|---|---|---|",
  ];
  for (const f of failures) {
    const atts =
      f.attachments
        .filter((a) => /\.(png|json|webm|zip)$/.test(a.name) || a.contentType)
        .map((a) => `\`${a.name}\``)
        .join(", ") || "—";
    lines.push(
      `| \`${f.project}\` | \`${f.file}\` → ${f.test} | ${f.retry} | ${
        f.pixelDiff ?? "—"
      } | ${atts} |`,
    );
  }
  lines.push("", "<details><summary>Failure messages (truncated)</summary>", "");
  for (const f of failures) {
    lines.push(`**${f.project} · ${f.test}**`, "", "```", f.message, "```", "");
  }
  lines.push("</details>");
  return lines.join("\n") + "\n";
}

// ---------- main ----------
const args = process.argv.slice(2);
const file = args[0];
const runUrlIdx = args.indexOf("--run-url");
const runUrl = runUrlIdx >= 0 ? args[runUrlIdx + 1] : "";
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;
const jsonIdx = args.indexOf("--json");
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;

if (!file) {
  console.error("usage: ci-e2e-summary.ts <results.json> --run-url <url> [--out <md>] [--json <json>]");
  process.exit(2);
}

let md: string;
let failures: Failure[] = [];
if (!existsSync(file)) {
  md = `### Playwright E2E — no JSON report\n\n\`${file}\` not found. Likely the run was aborted before the JSON reporter wrote its output.\n`;
} else {
  try {
    const report: Report = JSON.parse(readFileSync(file, "utf8"));
    failures = parse(report);
    md = fmtMd(failures, runUrl);
  } catch (err) {
    md = `### Playwright E2E — failed to parse JSON\n\n\`\`\`\n${(err as Error).message}\n\`\`\`\n`;
  }
}

if (outFile) writeFileSync(outFile, md);
if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        schema: "e2e-failure-summary/v1",
        runUrl,
        total: failures.length,
        failures,
      },
      null,
      2,
    ),
  );
}
process.stdout.write(md);
