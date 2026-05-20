// Strict schema validators for the JSON files produced by the
// sticky replay CLIs (`ci-sticky-newest-wins-overlap-replay.ts` and
// `ci-sticky-fuzz-failure-replay.ts`).
//
// Each validator returns a list of human-readable problems naming the
// exact JSON path of the offending field AND a short snippet of the
// received value, so reviewers can pinpoint the broken field without
// re-reading the artifact in a JSON viewer. An empty list means the
// payload is valid. Callers consolidate the messages into a single
// clear error so silently-broken outputs never reach downstream
// consumers (CI bots, dashboards, the local-repro CLI).

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

/**
 * Compact, bounded JSON-like preview of `v`. Always short (<= 80 chars)
 * so it can be embedded in single-line problem messages without
 * blowing up the error output when the offending value is huge.
 */
export function snippet(v: unknown): string {
  if (v === undefined) return "undefined";
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  if (s.length > 80) s = s.slice(0, 77) + "...";
  return s;
}

/**
 * Build a problem string that names the JSON path, the expected shape,
 * and the actual received value snippet.
 *
 * Format: `${path} is missing or not a ${expected} (got: ${snippet})`
 *
 * The "is missing or not a ..." prefix is load-bearing — several
 * existing tests grep for it. Keep it stable.
 */
function problem(path: string, expected: string, got: unknown): string {
  return `${path} is missing or not ${expected} (got: ${snippet(got)})`;
}

// Backward-compatible schema acceptance. Older artifacts pinned to v1
// (and any future minor revisions of the v1 family, e.g. "v1.1") must
// keep validating even after a v2 ships, so historic CI bundles and
// committed fuzz failures stay usable. Add new compatible literals to
// the arrays below; do NOT remove v1 without a major migration.
export const ACCEPTED_OVERLAP_REPLAY_SCHEMAS: readonly string[] = [
  "sticky-replay/v1",
];
export const ACCEPTED_FUZZ_REPLAY_SCHEMAS: readonly string[] = [
  "sticky-fuzz-replay/v1",
];
export const ACCEPTED_FUZZ_FAILURE_SCHEMAS: readonly string[] = [
  "sticky-fuzz-failure/v1",
];
export const ACCEPTED_MANIFEST_SCHEMAS: readonly string[] = [
  "sticky-artifacts-manifest/v1",
];

/**
 * Accept exact match against the listed schema versions, plus any
 * additive v1 minor revision (e.g. "sticky-replay/v1.1") that shares
 * the same `<family>/v<major>.` prefix. Never widens across majors.
 */
export function isAcceptedSchema(
  value: unknown,
  accepted: readonly string[],
): boolean {
  if (typeof value !== "string") return false;
  if (accepted.includes(value)) return true;
  for (const a of accepted) {
    const m = a.match(/^(.*)\/v(\d+)$/);
    if (!m) continue;
    const prefix = `${m[1]}/v${m[2]}.`;
    if (value.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Restrict a list of problem messages to those whose JSON path starts
 * with one of the given dotted prefixes (e.g. `inputs`, `matcher`).
 * The schema-mismatch message and root-object error are always kept
 * so users never get a silent green run on a fundamentally broken doc.
 */
export function filterProblemsByPath(
  problems: string[],
  prefixes: string[],
): string[] {
  if (prefixes.length === 0) return problems;
  const normalized = prefixes.map((p) => (p.startsWith(".") ? p : `.${p}`));
  return problems.filter((m) => {
    if (m.startsWith("schema=") || m.includes("not a JSON object")) return true;
    return normalized.some((pref) => m.startsWith(pref));
  });
}



export function validateOverlapReplayResult(r: unknown): string[] {
  const p: string[] = [];
  if (!isPlainObject(r)) return ["replay result is not a JSON object"];
  if (!isAcceptedSchema(r.schema, ACCEPTED_OVERLAP_REPLAY_SCHEMAS)) {
    p.push(
      `schema=${JSON.stringify(r.schema)} (expected one of ${JSON.stringify(ACCEPTED_OVERLAP_REPLAY_SCHEMAS)}) at path .schema`,
    );
  }
  if (typeof r.scenario !== "string") p.push(problem(".scenario", "a string", r.scenario));
  if (typeof r.headScanLines !== "number") p.push(problem(".headScanLines", "a number", r.headScanLines));
  if (typeof r.strategy !== "string") p.push(problem(".strategy", "a string", r.strategy));
  if (typeof r.action !== "string") p.push(problem(".action", "a string", r.action));
  if (typeof r.selectedId !== "number") p.push(problem(".selectedId", "a number", r.selectedId));
  if (!isNumberArray(r.cleanedIds)) p.push(problem(".cleanedIds", "a number[]", r.cleanedIds));
  if (typeof r.usedFullScan !== "boolean") p.push(problem(".usedFullScan", "a boolean", r.usedFullScan));
  if (!isPlainObject(r.scanStats)) p.push(problem(".scanStats", "an object", r.scanStats));
  if (!isNumberArray(r.finalIds)) p.push(problem(".finalIds", "a number[]", r.finalIds));
  if (typeof r.timestamp !== "string") p.push(problem(".timestamp", "a string", r.timestamp));
  return p;
}

export function validateFuzzReplayResult(r: unknown): string[] {
  const p: string[] = [];
  if (!isPlainObject(r)) return ["replay result is not a JSON object"];
  if (!isAcceptedSchema(r.schema, ACCEPTED_FUZZ_REPLAY_SCHEMAS)) {
    p.push(
      `schema=${JSON.stringify(r.schema)} (expected one of ${JSON.stringify(ACCEPTED_FUZZ_REPLAY_SCHEMAS)}) at path .schema`,
    );
  }
  if (typeof r.source !== "string") p.push(problem(".source", "a string", r.source));
  if (!isPlainObject(r.artifact)) p.push(problem(".artifact", "an object", r.artifact));
  if (!isPlainObject(r.inputs)) p.push(problem(".inputs", "an object", r.inputs));
  else {
    const inp = r.inputs as Record<string, unknown>;
    if (typeof inp.markerLiteral !== "string") {
      p.push(problem(".inputs.markerLiteral", "a string", inp.markerLiteral));
    }
    if (typeof inp.bodyLength !== "number") {
      p.push(problem(".inputs.bodyLength", "a number", inp.bodyLength));
    }
  }
  if (!isPlainObject(r.matcher)) p.push(problem(".matcher", "an object", r.matcher));
  else {
    const m = r.matcher as Record<string, unknown>;
    if (!isPlainObject(m.headScan)) p.push(problem(".matcher.headScan", "an object", m.headScan));
    if (!isPlainObject(m.fullScan)) p.push(problem(".matcher.fullScan", "an object", m.fullScan));
  }
  if (!isPlainObject(r.capturedAtFailure)) {
    p.push(problem(".capturedAtFailure", "an object", r.capturedAtFailure));
  }
  if (typeof r.timestamp !== "string") p.push(problem(".timestamp", "a string", r.timestamp));
  return p;
}

export function formatProblems(kind: string, path: string, problems: string[]): string {
  const head = `[${kind}] generated payload at ${path} failed schema validation ` +
    `(${problems.length} problem${problems.length === 1 ? "" : "s"}):`;
  return [head, ...problems.map((p) => `  - ${p}`)].join("\n");
}
