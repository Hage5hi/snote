// Strict schema validators for the JSON files produced by the
// sticky replay CLIs (`ci-sticky-newest-wins-overlap-replay.ts` and
// `ci-sticky-fuzz-failure-replay.ts`).
//
// Each validator returns a list of human-readable problems with the
// offending field named. An empty list means the payload is valid.
// Callers consolidate the messages into a single clear error so
// silently-broken outputs never reach downstream consumers (CI bots,
// dashboards, the local-repro CLI).

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

export function validateOverlapReplayResult(r: unknown): string[] {
  const p: string[] = [];
  if (!isPlainObject(r)) return ["replay result is not a JSON object"];
  if (r.schema !== "sticky-replay/v1") {
    p.push(`schema=${JSON.stringify(r.schema)} (expected "sticky-replay/v1")`);
  }
  if (typeof r.scenario !== "string") p.push("scenario is missing or not a string");
  if (typeof r.headScanLines !== "number") p.push("headScanLines is missing or not a number");
  if (typeof r.strategy !== "string") p.push("strategy is missing or not a string");
  if (typeof r.action !== "string") p.push("action is missing or not a string");
  if (typeof r.selectedId !== "number") p.push("selectedId is missing or not a number");
  if (!isNumberArray(r.cleanedIds)) p.push("cleanedIds is missing or not a number[]");
  if (typeof r.usedFullScan !== "boolean") p.push("usedFullScan is missing or not a boolean");
  if (!isPlainObject(r.scanStats)) p.push("scanStats is missing or not an object");
  if (!isNumberArray(r.finalIds)) p.push("finalIds is missing or not a number[]");
  if (typeof r.timestamp !== "string") p.push("timestamp is missing or not a string");
  return p;
}

export function validateFuzzReplayResult(r: unknown): string[] {
  const p: string[] = [];
  if (!isPlainObject(r)) return ["replay result is not a JSON object"];
  if (r.schema !== "sticky-fuzz-replay/v1") {
    p.push(`schema=${JSON.stringify(r.schema)} (expected "sticky-fuzz-replay/v1")`);
  }
  if (typeof r.source !== "string") p.push("source is missing or not a string");
  if (!isPlainObject(r.artifact)) p.push("artifact is missing or not an object");
  if (!isPlainObject(r.inputs)) p.push("inputs is missing or not an object");
  else {
    if (typeof (r.inputs as Record<string, unknown>).markerLiteral !== "string") {
      p.push("inputs.markerLiteral is missing or not a string");
    }
    if (typeof (r.inputs as Record<string, unknown>).bodyLength !== "number") {
      p.push("inputs.bodyLength is missing or not a number");
    }
  }
  if (!isPlainObject(r.matcher)) p.push("matcher is missing or not an object");
  else {
    const m = r.matcher as Record<string, unknown>;
    if (!isPlainObject(m.headScan)) p.push("matcher.headScan is missing or not an object");
    if (!isPlainObject(m.fullScan)) p.push("matcher.fullScan is missing or not an object");
  }
  if (!isPlainObject(r.capturedAtFailure)) p.push("capturedAtFailure is missing or not an object");
  if (typeof r.timestamp !== "string") p.push("timestamp is missing or not a string");
  return p;
}

export function formatProblems(kind: string, path: string, problems: string[]): string {
  const head = `[${kind}] generated payload at ${path} failed schema validation ` +
    `(${problems.length} problem${problems.length === 1 ? "" : "s"}):`;
  return [head, ...problems.map((p) => `  - ${p}`)].join("\n");
}
