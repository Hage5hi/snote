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

export function validateOverlapReplayResult(r: unknown): string[] {
  const p: string[] = [];
  if (!isPlainObject(r)) return ["replay result is not a JSON object"];
  if (r.schema !== "sticky-replay/v1") {
    p.push(
      `schema=${JSON.stringify(r.schema)} (expected "sticky-replay/v1") at path .schema`,
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
  if (r.schema !== "sticky-fuzz-replay/v1") {
    p.push(
      `schema=${JSON.stringify(r.schema)} (expected "sticky-fuzz-replay/v1") at path .schema`,
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
