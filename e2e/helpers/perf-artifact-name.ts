// Shared naming convention for CommandPalette perf artifacts (trace zips +
// JSON summaries). Every artifact name AND its on-disk path must embed both
// the test-title slug and a unique run id so multiple F5 reruns and retries
// stay easy to correlate from the CI artifacts pane.
//
// Pattern: `cmdk-perf-<kind>-<slug>-<runId>.<ext>`
//   kind  = "trace" | "summary"
//   slug  = lowercase, dash-separated test title
//   runId = `${workerIndex}-${retry}-${suffix}` (suffix defaults to Date.now())
//   ext   = "zip" (trace) | "json" (summary)
import type { TestInfo } from "@playwright/test";

export type PerfArtifactKind = "trace" | "summary";

export function slugifyTitle(title: string): string {
  return title.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase();
}

export function buildRunId(testInfo: TestInfo, suffix?: string | number): string {
  const tail = suffix !== undefined ? String(suffix) : String(Date.now());
  return `${testInfo.workerIndex}-${testInfo.retry}-${tail}`;
}

export function buildArtifactName(
  testInfo: TestInfo,
  kind: PerfArtifactKind,
  runId: string,
): string {
  const ext = kind === "trace" ? "zip" : "json";
  return `cmdk-perf-${kind}-${slugifyTitle(testInfo.title)}-${runId}.${ext}`;
}

// Matches anything produced by `buildArtifactName`. Capture groups:
//   1: kind  2: slug  3: runId  4: ext
export const PERF_ARTIFACT_NAME_RE =
  /cmdk-perf-(trace|summary)-([a-z0-9-]+)-(\d+-\d+-[^./]+)\.(zip|json)$/;

export function assertArtifactNameValid(
  name: string,
  expected: { slug: string; runId: string; kind: PerfArtifactKind },
): void {
  const m = name.match(PERF_ARTIFACT_NAME_RE);
  if (!m) throw new Error(`artifact name does not match canonical pattern: ${name}`);
  const [, kind, slug, runId] = m;
  if (kind !== expected.kind) throw new Error(`artifact kind mismatch: ${name} (want ${expected.kind})`);
  if (slug !== expected.slug) throw new Error(`artifact slug mismatch: ${name} (want ${expected.slug})`);
  if (runId !== expected.runId) throw new Error(`artifact runId mismatch: ${name} (want ${expected.runId})`);
}
