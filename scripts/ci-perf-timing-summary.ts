#!/usr/bin/env bun
// Emit a per-test timing table for the reduced-motion CodeMirror E2E and
// the README CI-download smoke into $GITHUB_STEP_SUMMARY so timing
// regressions are visible at a glance from the CI run page.
//
// Inputs (both optional — missing files are skipped, never fatal):
//   --pw   <path>   Playwright JSON reporter output (test-results/e2e-results.json)
//   --vt   <path>   Vitest JSON reporter output
//   --out  <path>   Markdown output (default: $GITHUB_STEP_SUMMARY)
//
// Reduced-motion spec: pulls `timing` annotations that already carry
//   `<shape>: total=<ms>ms, ...` — parsed into a shape → ms row.
// README smoke test: uses Vitest's per-test `duration` in ms.
//
// Non-zero exit only on malformed CLI usage; parse errors log to stderr
// and continue so CI summary always renders.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

type PwAnnot = { type: string; description?: string };
type PwTest = { title: string; projectName?: string; annotations?: PwAnnot[]; results?: Array<{ duration?: number; status?: string }> };
type PwSpec = { title: string; file: string; tests: PwTest[] };
type PwSuite = { title?: string; specs?: PwSpec[]; suites?: PwSuite[] };
type PwReport = { suites?: PwSuite[] };

function* walk(suites: PwSuite[] | undefined): Generator<PwSpec> {
  for (const s of suites ?? []) {
    for (const sp of s.specs ?? []) yield sp;
    yield* walk(s.suites);
  }
}

export interface TimingRow {
  suite: string;   // "reduced-motion" | "readme-smoke"
  name: string;    // shape or test title
  project?: string;
  durationMs: number;
  status?: string;
  extra?: string;  // e.g. "cls=0.001 scrollTop=420"
}

export function parsePlaywright(report: PwReport): TimingRow[] {
  const rows: TimingRow[] = [];
  for (const spec of walk(report.suites)) {
    if (!spec.file.includes("codemirror-reduced-motion-selection")) continue;
    for (const t of spec.tests) {
      const timing = (t.annotations ?? []).find((a) => a.type === "timing");
      const desc = timing?.description ?? "";
      const m = desc.match(/^([^:]+):\s*total=(\d+)ms(?:,\s*(.+))?$/);
      const last = t.results?.[t.results.length - 1];
      if (m) {
        rows.push({
          suite: "reduced-motion", name: m[1].trim(), project: t.projectName,
          durationMs: Number(m[2]), status: last?.status, extra: m[3],
        });
      } else if (last?.duration != null) {
        rows.push({
          suite: "reduced-motion", name: t.title, project: t.projectName,
          durationMs: Math.round(last.duration), status: last.status,
        });
      }
    }
  }
  return rows;
}

// ---------- Failed-test artifact links ----------
// Playwright writes attachments (trace.zip, screenshots, videos) into
// per-test folders under `test-results/`. The full-run artifact bundle
// uploaded by CI is browsable from the workflow run's Artifacts panel;
// we deep-link to it so a failing summary is one click from evidence.
export interface FailedTestArtifacts {
  suite: string; name: string; project?: string;
  attachments: Array<{ label: string; path: string }>;
}

export function parsePlaywrightFailedArtifacts(report: PwReport): FailedTestArtifacts[] {
  const out: FailedTestArtifacts[] = [];
  for (const spec of walk(report.suites)) {
    for (const t of spec.tests) {
      const last = t.results?.[t.results.length - 1] as { status?: string; attachments?: Array<{ name?: string; path?: string }> } | undefined;
      if (!last || last.status === "passed" || last.status === "skipped") continue;
      const attachments = (last.attachments ?? [])
        .filter((a) => a.path && (/trace\.zip$/.test(a.path) || /\.(png|json)$/.test(a.path)))
        .map((a) => ({ label: a.name ?? a.path!.split("/").pop() ?? "artifact", path: a.path! }));
      if (attachments.length) out.push({ suite: spec.file, name: t.title, project: t.projectName, attachments });
    }
  }
  return out;
}

export function renderFailedArtifactLinks(
  failed: FailedTestArtifacts[],
  env: { serverUrl?: string; repository?: string; runId?: string; runAttempt?: string } = {},
): string {
  if (failed.length === 0) return "";
  const runUrl = env.serverUrl && env.repository && env.runId
    ? `${env.serverUrl}/${env.repository}/actions/runs/${env.runId}${env.runAttempt ? `/attempts/${env.runAttempt}` : ""}#artifacts`
    : null;
  const out: string[] = ["### 🔗 Failed-test artifacts\n"];
  if (runUrl) out.push(`Browse the full artifact bundle from the [workflow run's Artifacts panel](${runUrl}).\n`);
  for (const f of failed) {
    out.push(`- **${f.name}**${f.project ? ` _(${f.project})_` : ""} — ${
      f.attachments.map((a) => `[${a.label}](${a.path})`).join(" · ")
    }`);
  }
  out.push("");
  return out.join("\n");
}

type VtTask = { name: string; result?: { duration?: number; state?: string }; tasks?: VtTask[] };
type VtFile = { name?: string; filepath?: string; tasks?: VtTask[] };
type VtReport = { testResults?: VtFile[] } | { files?: VtFile[] };

function* vtTasks(t: VtTask): Generator<VtTask> {
  if (!t.tasks?.length) { yield t; return; }
  for (const c of t.tasks) yield* vtTasks(c);
}

export function parseVitest(report: VtReport): TimingRow[] {
  const rows: TimingRow[] = [];
  const files = (report as { files?: VtFile[] }).files
    ?? (report as { testResults?: VtFile[] }).testResults ?? [];
  for (const f of files) {
    const path = f.filepath ?? f.name ?? "";
    if (!/readme-ci-download-walkthrough(-smoke)?\.test\.ts$/.test(path)) continue;
    const suite = path.includes("-smoke") ? "readme-smoke" : "readme-walkthrough";
    for (const top of f.tasks ?? []) for (const leaf of vtTasks(top)) {
      const dur = leaf.result?.duration;
      if (dur == null) continue;
      rows.push({
        suite, name: leaf.name, durationMs: Math.round(dur),
        status: leaf.result?.state,
      });
    }
  }
  return rows;
}

export function renderMarkdown(rows: TimingRow[]): string {
  if (rows.length === 0) return "### ⏱ Per-test timing\n\n_no timing rows collected_\n";
  const grouped = new Map<string, TimingRow[]>();
  for (const r of rows) {
    const arr = grouped.get(r.suite) ?? [];
    arr.push(r); grouped.set(r.suite, arr);
  }
  const out: string[] = ["### ⏱ Per-test timing\n"];
  for (const [suite, list] of grouped) {
    list.sort((a, b) => b.durationMs - a.durationMs);
    out.push(`#### ${suite}\n`);
    out.push("| test | project | duration (ms) | status | notes |");
    out.push("|---|---|---:|---|---|");
    for (const r of list) {
      out.push(`| ${r.name} | ${r.project ?? "-"} | ${r.durationMs} | ${r.status ?? "-"} | ${r.extra ?? ""} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(readFileSync(p, "utf8")) as T; }
  catch (e) { console.error(`[perf-timing] skipping ${p}: ${(e as Error).message}`); return null; }
}

// ---------- S3 retry log ----------
// JSONL emitted by `s3-upload-with-retry.ts`'s `onRetry` hook: one
// `{key,attempt,delayMs,category,error}` object per retry attempt.
export interface S3RetrySample {
  key: string; attempt: number; delayMs: number;
  category: "http-throttle" | "http-5xx" | "network" | "timeout" | "none";
  error?: string; suite?: string;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function histogramBuckets(values: number[]): Array<{ label: string; count: number }> {
  // Log-ish buckets in ms — matches typical backoff shapes (200,400,800,…).
  const edges = [0, 100, 250, 500, 1000, 2000, 5000, 10_000, Infinity];
  const buckets = edges.slice(0, -1).map((lo, i) => ({
    label: edges[i + 1] === Infinity ? `≥${lo}ms` : `${lo}–${edges[i + 1]}ms`,
    count: 0,
  }));
  for (const v of values) {
    for (let i = 0; i < edges.length - 1; i++) {
      if (v >= edges[i] && v < edges[i + 1]) { buckets[i].count++; break; }
    }
  }
  return buckets;
}

export function renderS3Markdown(samples: S3RetrySample[]): string {
  if (samples.length === 0) return "";
  const delays = samples.map((s) => s.delayMs).sort((a, b) => a - b);
  const worst = delays[delays.length - 1];
  const out: string[] = ["### ☁️ S3 retry stats\n"];
  out.push(`**Total retries:** ${samples.length} · **p50:** ${pct(delays, 50)}ms · **p95:** ${pct(delays, 95)}ms · **worst:** ${worst}ms\n`);

  out.push("#### Backoff delay histogram\n");
  out.push("| bucket | count |", "|---|---:|");
  for (const b of histogramBuckets(delays)) out.push(`| ${b.label} | ${b.count} |`);
  out.push("");

  // Per-category totals + worst delay in that category.
  const byCat = new Map<string, S3RetrySample[]>();
  for (const s of samples) {
    const arr = byCat.get(s.category) ?? [];
    arr.push(s); byCat.set(s.category, arr);
  }
  out.push("#### Transient error categories\n");
  out.push("| category | retries | worst delay (ms) | example key |");
  out.push("|---|---:|---:|---|");
  const cats = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [cat, list] of cats) {
    const w = list.reduce((m, s) => (s.delayMs > m.delayMs ? s : m), list[0]);
    out.push(`| ${cat} | ${list.length} | ${w.delayMs} | \`${w.key}\` |`);
  }
  out.push("");
  return out.join("\n");
}

function readS3Jsonl(p: string): S3RetrySample[] {
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as S3RetrySample);
  } catch (e) {
    console.error(`[perf-timing] skipping ${p}: ${(e as Error).message}`); return [];
  }
}

function main(argv: string[]): void {
  let pw: string | undefined, vt: string | undefined, out: string | undefined, s3: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pw") pw = argv[++i];
    else if (a === "--vt") vt = argv[++i];
    else if (a === "--s3") s3 = argv[++i];
    else if (a === "--out") out = argv[++i];
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  const rows: TimingRow[] = [];
  let failedArtifacts: FailedTestArtifacts[] = [];
  if (pw && existsSync(pw)) {
    const r = readJson<PwReport>(pw);
    if (r) { rows.push(...parsePlaywright(r)); failedArtifacts = parsePlaywrightFailedArtifacts(r); }
  }
  if (vt && existsSync(vt)) { const r = readJson<VtReport>(vt); if (r) rows.push(...parseVitest(r)); }
  const s3Samples = s3 && existsSync(s3) ? readS3Jsonl(s3) : [];
  const md = [
    renderMarkdown(rows),
    s3Samples.length ? renderS3Markdown(s3Samples) : "",
    renderFailedArtifactLinks(failedArtifacts, {
      serverUrl: process.env.GITHUB_SERVER_URL, repository: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    }),
  ].filter(Boolean).join("\n");
  const dest = out ?? process.env.GITHUB_STEP_SUMMARY;
  if (dest) {
    if (out) writeFileSync(dest, md);
    else appendFileSync(dest, md + "\n");
  } else {
    process.stdout.write(md);
  }
}

if (import.meta.main) main(process.argv.slice(2));
