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

function artifactUrl(runUrl: string, artifactId?: string): string | undefined {
  if (!artifactId) return undefined;
  const base = runUrl.replace(/#.*$/, "");
  return `${base}/artifacts/${artifactId}`;
}

/** Build a deep-link into the Playwright trace viewer for a single test.
 *
 * Two modes:
 *   1. `--trace-base-url <url>`: a publicly-fetchable URL prefix where the
 *      `test-results/` folder is mirrored (e.g. GitHub Pages, S3, Vercel
 *      preview). We construct
 *      `https://trace.playwright.dev/?trace=<baseUrl>/<trace.zip>`
 *      so the link opens the exact trace one-click.
 *   2. No base URL: emit the relative path so reviewers know which file to
 *      drag onto trace.playwright.dev after downloading the report artifact.
 */
function traceLink(
  attachments: AttachmentRef[],
  traceBaseUrl: string | undefined,
): { label: string; href?: string } | undefined {
  const trace = attachments.find(
    (a) => a.name === "trace" || /trace\.zip$/.test(a.path ?? "") || /trace\.zip$/.test(a.name),
  );
  if (!trace?.path) return undefined;
  // Normalize: paths in JSON reporter are repo-absolute; strip leading
  // `test-results/` only when we have a base URL pointing at that folder.
  const rel = trace.path.replace(/^.*?test-results\//, "test-results/");
  if (traceBaseUrl) {
    const tracedUrl = `${traceBaseUrl.replace(/\/$/, "")}/${rel}`;
    return {
      label: "open trace",
      href: `https://trace.playwright.dev/?trace=${encodeURIComponent(tracedUrl)}`,
    };
  }
  return { label: `trace: \`${rel}\`` };
}

function fmtMd(
  failures: Failure[],
  runUrl: string,
  reportArtifactId?: string,
  debugArtifactId?: string,
  browser?: string,
  traceBaseUrl?: string,
): string {
  if (failures.length === 0) {
    return "### Playwright E2E — all green\n\nNo failing tests in this run.\n";
  }
  const reportUrl = artifactUrl(runUrl, reportArtifactId);
  const debugUrl = artifactUrl(runUrl, debugArtifactId);
  const lines = [
    `### Playwright E2E${browser ? ` · ${browser}` : ""} — ${failures.length} failing test(s)`,
    "",
    `- All artifacts: [open run artifacts](${runUrl})`,
    reportUrl ? `- Playwright HTML report: [download](${reportUrl})` : "",
    debugUrl ? `- Debug bundle (screenshots, traces, axe JSON): [download](${debugUrl})` : "",
    traceBaseUrl
      ? `- Trace links below open directly in [trace.playwright.dev](https://trace.playwright.dev)`
      : `- Trace viewer: download the report above and drop the listed \`trace.zip\` onto [trace.playwright.dev](https://trace.playwright.dev)`,
    "",
    "| Project | Spec → Test | Retry | Pixel diff | Trace | Debug |",
    "|---|---|---|---|---|---|",
  ].filter(Boolean);
  for (const f of failures) {
    const atts =
      f.attachments
        .filter((a) => /\.(png|json|webm|zip)$/.test(a.name) || a.contentType)
        .map((a) => `\`${a.name}\``)
        .join("<br>") || "—";
    const trace = traceLink(f.attachments, traceBaseUrl);
    const traceCell = trace
      ? trace.href
        ? `[${trace.label}](${trace.href})`
        : trace.label
      : "—";
    const debugCell = debugUrl ? `[bundle](${debugUrl})<br>${atts}` : atts;
    lines.push(
      `| \`${f.project}\` | \`${f.file}\` → ${f.test} | ${f.retry} | ${
        f.pixelDiff ?? "—"
      } | ${traceCell} | ${debugCell} |`,
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
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const runUrl = flag("--run-url") ?? "";
const outFile = flag("--out");
const jsonOut = flag("--json");
const reportArtifactId = flag("--report-artifact-id");
const debugArtifactId = flag("--debug-artifact-id");
const browser = flag("--browser");
const traceBaseUrl = flag("--trace-base-url") ?? process.env.PLAYWRIGHT_TRACE_BASE_URL;

if (!file) {
  console.error(
    "usage: ci-e2e-summary.ts <results.json> --run-url <url> [--out <md>] [--json <json>] " +
      "[--report-artifact-id <id>] [--debug-artifact-id <id>] [--browser <name>] " +
      "[--trace-base-url <https://...>]",
  );
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
    md = fmtMd(failures, runUrl, reportArtifactId, debugArtifactId, browser, traceBaseUrl);
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
