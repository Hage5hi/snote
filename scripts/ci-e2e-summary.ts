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
type Annotation = { type: string; description?: string };
type TestResult = {
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  error?: { message?: string };
  attachments?: AttachmentRef[];
  retry?: number;
};
type TestEntry = {
  title: string;
  results: TestResult[];
  projectName?: string;
  annotations?: Annotation[];
};
type SpecEntry = { title: string; file: string; tests: TestEntry[] };
type SuiteEntry = { title?: string; specs?: SpecEntry[]; suites?: SuiteEntry[] };
type Report = { suites?: SuiteEntry[]; stats?: { duration?: number } };

interface DiffImageSet {
  expected?: AttachmentRef;
  actual?: AttachmentRef;
  diff?: AttachmentRef;
}

/** Auxiliary debug artifacts attached by hit-test / flicker specs.
 *  Distinct from the expected/actual/diff trio produced by toHaveScreenshot:
 *  these are spec-attached PNGs (mask overlays, flicker frames, axe JSON).
 *  Surfaced as a separate column so reviewers can open them in one click. */
interface OverlayAttachments {
  mask: AttachmentRef[];      // debug-mask-*.png from home-scene.spec.ts
  hitTest: AttachmentRef[];   // debug-hit*.png / hit-test overlays
  flicker: AttachmentRef[];   // flicker-a.png / flicker-b.png
  axe: AttachmentRef[];       // axe-*.json
}

interface Failure {
  file: string;
  spec: string;
  test: string;
  project: string;
  retry: number;
  message: string;
  pixelDiff?: string;       // parsed "ratio 0.012" from the error message
  threshold?: string;       // resolved per-scene maxDiffPixelRatio (from annotations)
  chromeThreshold?: string; // resolved chrome screenshot threshold
  sceneThreshold?: string;  // resolved masked-layer / hit-test threshold
  scene?: string;           // from annotations
  override?: string;        // SCENE_DIFF_RATIOS hit, when present
  chromeOverride?: string;  // CHROME_DIFF_RATIO hit, when present
  attachments: AttachmentRef[];
  images: DiffImageSet;
  overlays: OverlayAttachments;
}

function* walkSpecs(suites: SuiteEntry[] | undefined): Generator<SpecEntry> {
  if (!suites) return;
  for (const s of suites) {
    if (s.specs) for (const sp of s.specs) yield sp;
    if (s.suites) yield* walkSpecs(s.suites);
  }
}

function extractPixelDiff(msg: string): string | undefined {
  const m = msg.match(/(?:ratio|threshold|maxDiffPixelRatio)[^\d]{0,8}([\d.]+)/i);
  if (m) return m[1];
  const pct = msg.match(/([\d.]+)\s*%\s*(?:of\s*)?pixels/i);
  if (pct) return `${pct[1]}%`;
  return undefined;
}

/** Group the *-expected/*-actual/*-diff PNG attachments that Playwright
 *  emits when toHaveScreenshot fails. */
function collectImages(atts: AttachmentRef[]): DiffImageSet {
  const out: DiffImageSet = {};
  for (const a of atts) {
    const name = (a.name ?? "") + " " + (a.path ?? "");
    if (/-expected\.png(\b|$)/i.test(name)) out.expected ??= a;
    else if (/-actual\.png(\b|$)/i.test(name)) out.actual ??= a;
    else if (/-diff\.png(\b|$)/i.test(name)) out.diff ??= a;
  }
  return out;
}

function annoValue(annos: Annotation[] | undefined, type: string): string | undefined {
  return annos?.find((a) => a.type === type)?.description;
}

/** Bucket spec-attached debug PNG/JSON files by purpose so the CI summary
 *  can render one-click links separately from the screenshot diff trio. */
function collectOverlays(atts: AttachmentRef[]): OverlayAttachments {
  const out: OverlayAttachments = { mask: [], hitTest: [], flicker: [], axe: [] };
  for (const a of atts) {
    const name = a.name ?? "";
    if (/-(expected|actual|diff)\.png$/i.test(name)) continue; // handled by collectImages
    if (/^debug-mask-/i.test(name)) out.mask.push(a);
    else if (/^debug-(hit|hittest|hit-test)/i.test(name)) out.hitTest.push(a);
    else if (/^flicker-/i.test(name)) out.flicker.push(a);
    else if (/^axe-/i.test(name) && /\.json$/i.test(name)) out.axe.push(a);
  }
  return out;
}

function parse(report: Report): Failure[] {
  const out: Failure[] = [];
  for (const spec of walkSpecs(report.suites)) {
    for (const t of spec.tests) {
      const last = t.results[t.results.length - 1];
      if (!last) continue;
      if (last.status === "passed" || last.status === "skipped") continue;
      const msg = last.error?.message ?? "(no message)";
      const atts = last.attachments ?? [];
      out.push({
        file: spec.file,
        spec: spec.title,
        test: t.title,
        project: t.projectName ?? "default",
        retry: last.retry ?? 0,
        message: msg.split("\n").slice(0, 4).join(" ").slice(0, 300),
        pixelDiff: extractPixelDiff(msg),
        threshold: annoValue(t.annotations, "pixelDiffRatio"),
        chromeThreshold: annoValue(t.annotations, "chromeDiffRatio"),
        sceneThreshold: annoValue(t.annotations, "sceneDiffRatio"),
        scene: annoValue(t.annotations, "scene"),
        override: annoValue(t.annotations, "pixelDiffOverride"),
        chromeOverride: annoValue(t.annotations, "chromeDiffOverride"),
        attachments: atts,
        images: collectImages(atts),
        overlays: collectOverlays(atts),
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

/** Build a one-click link to a single attachment file (PNG/diff/etc).
 *  Same caveat as trace links: works only when `--trace-base-url` (or env)
 *  points at a publicly-fetchable mirror of `test-results/`. Otherwise we
 *  emit the relative path so reviewers can locate the file in the artifact zip. */
function imageLink(
  att: AttachmentRef | undefined,
  baseUrl: string | undefined,
  label: string,
): string | undefined {
  if (!att?.path) return undefined;
  const rel = att.path.replace(/^.*?test-results\//, "test-results/");
  if (baseUrl) {
    const url = `${baseUrl.replace(/\/$/, "")}/${rel}`;
    return `[${label}](${url})`;
  }
  return `${label}: \`${rel}\``;
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
      ? `- Trace + image links below open directly from \`${traceBaseUrl}\``
      : `- Trace/image links show the relative path inside the report artifact (download then open). Set \`PLAYWRIGHT_TRACE_BASE_URL\` for one-click links.`,
    "",
    // Threshold column = the per-scene maxDiffPixelRatio actually used.
    // Pixel diff column = the actual diff observed in the failure message.
    "| Project | Spec → Test | Scene | Retry | Threshold | Observed diff | Images | Trace | Debug |",
    "|---|---|---|---|---|---|---|---|---|",
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
    const imgs = [
      imageLink(f.images.expected, traceBaseUrl, "expected"),
      imageLink(f.images.actual, traceBaseUrl, "actual"),
      imageLink(f.images.diff, traceBaseUrl, "diff"),
    ].filter(Boolean).join("<br>") || "—";
    const debugCell = debugUrl ? `[bundle](${debugUrl})<br>${atts}` : atts;
    const sceneCell = f.scene
      ? f.override
        ? `\`${f.scene}\`<sup>*</sup>` // marker for override applied
        : `\`${f.scene}\``
      : "—";
    const thresholdCell = f.threshold ?? "—";
    lines.push(
      `| \`${f.project}\` | \`${f.file}\` → ${f.test} | ${sceneCell} | ${f.retry} | ${thresholdCell} | ${
        f.pixelDiff ?? "—"
      } | ${imgs} | ${traceCell} | ${debugCell} |`,
    );
  }
  // Footnote for the override marker.
  if (failures.some((f) => f.override)) {
    lines.push("", "<sup>*</sup> threshold was overridden via `SCENE_DIFF_RATIOS`/`--scene-diff` (see annotations).");
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
