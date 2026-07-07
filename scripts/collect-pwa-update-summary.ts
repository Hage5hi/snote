// Walks playwright-report/ and test-results/ collecting every pwa-update-*.json
// attachment produced by the PWA update e2e specs and consolidates the current
// vs pending buildId (from both the toast metadata and the poller state) into
// a single JSON summary uploaded as a CI artifact.
//
// Usage: bun run scripts/collect-pwa-update-summary.ts [--out test-results/pwa-update-summary.json]

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";

type PwaSample = {
  file: string;
  label: string;
  currentBuildId: string | null;
  pendingBuildId: string | null;
  reloadAttemptCount: number | null;
  reloadStrategy: string | null;
  updateAvailable: boolean | null;
  updateInProgress: boolean | null;
  toastText: string | null;
};

function walk(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) walk(full, out);
    else if (/^pwa-update.*\.json$/i.test(entry)) out.push(full);
  }
  return out;
}

function parse(file: string): PwaSample | null {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const state = raw?.state ?? {};
    const label = basename(file).replace(/^pwa-update-?/, "").replace(/\.json$/, "") || "root";
    return {
      file,
      label,
      currentBuildId: state.currentBuildId ?? null,
      pendingBuildId: state.pendingBuildId ?? null,
      reloadAttemptCount: state.reloadAttemptCount ?? null,
      reloadStrategy: state.reloadStrategy ?? null,
      updateAvailable: state.updateAvailable ?? null,
      updateInProgress: state.updateInProgress ?? null,
      toastText: raw?.toastText ?? null,
    };
  } catch {
    return null;
  }
}

const outIdx = process.argv.indexOf("--out");
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : "test-results/pwa-update-summary.json";

const files = [...walk("playwright-report"), ...walk("test-results")];
const samples = files.map(parse).filter((s): s is PwaSample => s !== null);

const buildIdMismatches = samples.filter(
  (s) => s.pendingBuildId && s.currentBuildId && s.pendingBuildId !== s.currentBuildId,
);

const summary = {
  generatedAt: new Date().toISOString(),
  sampleCount: samples.length,
  buildIdMismatchCount: buildIdMismatches.length,
  samples,
  buildIdMismatches,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.log(`[pwa-update-summary] wrote ${outPath} (${samples.length} samples, ${buildIdMismatches.length} mismatches)`);
