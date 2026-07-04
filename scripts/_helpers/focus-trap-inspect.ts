// Shared helpers for scripts/inspect-focus-trap.ts.
//
// Extracted so unit tests can pin the schema shape, CSV escaping rules
// and column ordering without booting the full CLI. The CLI stays a
// thin wrapper around these pure functions.

export type FocusHistoryEntry = {
  event?: string;
  perf?: number;
  snapshot?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

export type FocusTrapPayload = {
  testTitle?: unknown;
  triggerNonce?: unknown;
  focusHistory?: FocusHistoryEntry[];
  lastRelocate?: Record<string, unknown> | null;
  iterTimings?: Record<string, Record<string, number | null>>;
  artifacts?: Record<string, string> | null;
  artifactUrls?: Record<string, string> | null;
};

// Structured schema issue so callers can surface the exact JSON pointer
// (RFC 6901), the field name that failed, and a short snippet of the
// offending value. Kept dep-free.
export type SchemaIssue = {
  pointer: string;   // e.g. "/focusHistory/0/event"
  field: string;     // e.g. "event"
  message: string;   // e.g. "expected string"
  value?: string;    // short JSON snippet of the bad value (<=80 chars)
};

const snippet = (v: unknown, max = 80): string => {
  let s: string;
  try { s = JSON.stringify(v); } catch { s = String(v); }
  if (s == null) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

export function formatIssue(i: SchemaIssue): string {
  const v = i.value !== undefined ? ` (got ${i.value})` : "";
  return `${i.pointer || "/"} [${i.field}]: ${i.message}${v}`;
}

// Minimal schema validator — no external deps. Returns [] when the
// payload matches the shape produced by e2e/helpers/install-prompt.ts,
// otherwise a list of structured issues. Callers should fail fast so a
// malformed artifact never silently degrades inspect or replay output.
export function validateFocusTrapPayload(input: unknown): SchemaIssue[] {
  const errs: SchemaIssue[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [{ pointer: "", field: "payload", message: "expected top-level object", value: snippet(input) }];
  }
  const p = input as Record<string, unknown>;
  if (!Array.isArray(p.focusHistory)) {
    errs.push({ pointer: "/focusHistory", field: "focusHistory", message: "required array", value: snippet(p.focusHistory) });
  } else {
    p.focusHistory.forEach((e, i) => {
      const ptr = `/focusHistory/${i}`;
      if (!e || typeof e !== "object") {
        errs.push({ pointer: ptr, field: `focusHistory[${i}]`, message: "expected object", value: snippet(e) });
        return;
      }
      const ev = (e as Record<string, unknown>).event;
      if (typeof ev !== "string") {
        errs.push({ pointer: `${ptr}/event`, field: "event", message: "expected string", value: snippet(ev) });
      }
    });
  }
  if (p.iterTimings != null && (typeof p.iterTimings !== "object" || Array.isArray(p.iterTimings))) {
    errs.push({ pointer: "/iterTimings", field: "iterTimings", message: "expected object when present", value: snippet(p.iterTimings) });
  }
  if (p.artifacts != null && (typeof p.artifacts !== "object" || Array.isArray(p.artifacts))) {
    errs.push({ pointer: "/artifacts", field: "artifacts", message: "expected object when present", value: snippet(p.artifacts) });
  }
  return errs;
}

// CSV column ordering is part of the CI contract — downstream jobs
// index by column position. `failureReason` is empty for healthy rows
// and populated with the parse/schema issue (or matched failure label)
// for invalid/mismatched artifacts.
export const CSV_COLUMNS = [
  "file", "spec", "browser", "attempt", "label", "testTitle",
  "firstEscapeEvent", "firstEscapePerfMs",
  "relocatePath", "relocateUsedFallback",
  "iterCount",
  "failureReason",
] as const;

// Column contracts for --json-report / --diff-out. Kept as exported
// constants so tests can pin the exact required set and callers can
// validate any header (including a rearranged one) before writing.
export const REQUIRED_DIFF_CSV_COLUMNS = [
  "file", "prevFailureReason", "prevSchemaPointer",
  "currFailureReason", "currSchemaPointer",
] as const;

// Bump when the shape of the artifact changes in a way consumers care
// about (new required key, removed key, semantic change). Keep the
// bump minor for additive-only changes and major for breaks. Consumers
// pin against a known set of versions and bail on anything else.
export const JSON_REPORT_SCHEMA_VERSION = "1.0.0";
export const DIFF_JSON_SCHEMA_VERSION = "1.0.0";

export const REQUIRED_JSON_REPORT_TOP_KEYS = [
  "schemaVersion",
  "generatedAt", "meta", "scanned", "matched",
  "valid", "invalid", "artifacts", "issues",
] as const;

export const REQUIRED_DIFF_JSON_TOP_KEYS = [
  "schemaVersion",
  "generatedAt", "meta", "diffWith", "changed", "rows",
] as const;

export const REQUIRED_DIFF_JSON_ROW_KEYS = [
  "file", "prevFailureReason", "prevSchemaPointer",
  "currFailureReason", "currSchemaPointer",
] as const;

export const REQUIRED_JSON_REPORT_ARTIFACT_KEYS = [
  "file", "failureKind", "failureReason",
  "schemaPointer", "quarantined",
] as const;

// Returns [] when the CSV header matches the pinned contract in the
// pinned order, else a list of human-readable errors. Callers should
// print each error and exit non-zero without writing the artifact.
export function validateDiffCsvHeader(header: readonly string[]): string[] {
  const errs: string[] = [];
  for (const c of REQUIRED_DIFF_CSV_COLUMNS) {
    if (!header.includes(c)) errs.push(`missing required column '${c}'`);
  }
  for (let i = 0; i < REQUIRED_DIFF_CSV_COLUMNS.length; i++) {
    if (header[i] !== REQUIRED_DIFF_CSV_COLUMNS[i]) {
      errs.push(`column ${i} must be '${REQUIRED_DIFF_CSV_COLUMNS[i]}', got '${header[i] ?? "<missing>"}'`);
      break; // first ordering error is enough
    }
  }
  return errs;
}

// RFC 6901 JSON Pointer reference-token escaping. Order matters: `~`
// must be replaced first (as `~0`) so a subsequent `/`→`~1` pass does
// not turn a literal `~1` back into `/`. Exported for tests + reuse.
export function escapeJsonPointerSegment(seg: string): string {
  return seg.replace(/~/g, "~0").replace(/\//g, "~1");
}

// Live-region announcement dedupe. The HTML report's client-side
// filter can fire many `input` events per keystroke and multiple
// disclosure toggles per user gesture; if we push every candidate
// verbatim into aria-live, screen readers announce stale/duplicate
// counts. This tiny reducer collapses consecutive duplicates and
// rejects empty strings so the announcement log is always a strict,
// monotonically-changing sequence — the same invariant the e2e test
// polls for. Pure + dep-free so it round-trips through unit tests.
export function dedupeAnnouncement(log: readonly string[], next: string): string[] {
  const t = (next ?? "").trim();
  if (!t) return log.slice();
  if (log.length && log[log.length - 1] === t) return log.slice();
  return [...log, t];
}

// Same idea for --json-report: enforce top-level keys and per-artifact
// keys so a shape drift fails fast.
export function validateJsonReport(report: unknown): string[] {
  const errs: string[] = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return ["report must be a top-level object [pointer=/]"];
  }
  const r = report as Record<string, unknown>;
  const P = escapeJsonPointerSegment;
  for (const k of REQUIRED_JSON_REPORT_TOP_KEYS) {
    if (!(k in r)) errs.push(`missing required top-level key '${k}' [pointer=/${P(k)}]`);
  }
  if ("schemaVersion" in r && r.schemaVersion !== JSON_REPORT_SCHEMA_VERSION) {
    errs.push(`'schemaVersion' must be '${JSON_REPORT_SCHEMA_VERSION}', got '${String(r.schemaVersion)}' [pointer=/schemaVersion]`);
  }
  if ("valid" in r && typeof r.valid !== "number")     errs.push(`'valid' must be a number, got ${typeof r.valid} [pointer=/valid]`);
  if ("invalid" in r && typeof r.invalid !== "number") errs.push(`'invalid' must be a number, got ${typeof r.invalid} [pointer=/invalid]`);
  if ("artifacts" in r) {
    if (!Array.isArray(r.artifacts)) errs.push("'artifacts' must be an array [pointer=/artifacts]");
    else r.artifacts.forEach((a, i) => {
      if (!a || typeof a !== "object") { errs.push(`artifacts[${i}]: expected object [pointer=/artifacts/${i}]`); return; }
      for (const k of REQUIRED_JSON_REPORT_ARTIFACT_KEYS) {
        if (!(k in (a as Record<string, unknown>))) errs.push(`artifacts[${i}]: missing required key '${k}' [pointer=/artifacts/${i}/${P(k)}]`);
      }
    });
  }
  return errs;
}

// Same idea for --diff-json-out: pin top keys, schemaVersion, and each
// row's contract so downstream automation can rely on the shape.
export function validateDiffJson(report: unknown): string[] {
  const errs: string[] = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return ["diff report must be a top-level object [pointer=/]"];
  }
  const r = report as Record<string, unknown>;
  const P = escapeJsonPointerSegment;
  for (const k of REQUIRED_DIFF_JSON_TOP_KEYS) {
    if (!(k in r)) errs.push(`missing required top-level key '${k}' [pointer=/${P(k)}]`);
  }
  if ("schemaVersion" in r && r.schemaVersion !== DIFF_JSON_SCHEMA_VERSION) {
    errs.push(`'schemaVersion' must be '${DIFF_JSON_SCHEMA_VERSION}', got '${String(r.schemaVersion)}' [pointer=/schemaVersion]`);
  }
  if ("changed" in r && typeof r.changed !== "number") errs.push(`'changed' must be a number, got ${typeof r.changed} [pointer=/changed]`);
  if ("rows" in r) {
    if (!Array.isArray(r.rows)) errs.push("'rows' must be an array [pointer=/rows]");
    else r.rows.forEach((row, i) => {
      if (!row || typeof row !== "object") { errs.push(`rows[${i}]: expected object [pointer=/rows/${i}]`); return; }
      for (const k of REQUIRED_DIFF_JSON_ROW_KEYS) {
        if (!(k in (row as Record<string, unknown>))) errs.push(`rows[${i}]: missing required key '${k}' [pointer=/rows/${i}/${P(k)}]`);
      }
    });
  }
  return errs;
}


export function escCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsvRow(entry: Record<string, unknown>): string {
  const fe = (entry.firstEscape as Record<string, unknown> | null) || null;
  const rl = (entry.relocate as Record<string, unknown> | null) || null;
  const values = [
    entry.file, entry.spec, entry.browser, entry.attempt, entry.label, entry.testTitle,
    fe?.event ?? "", fe?.perf ?? "",
    rl?.path ?? "", rl?.usedFallback ?? "",
    Object.keys((entry.iterTimings as object) || {}).length,
    entry.failureReason ?? "",
  ];
  return values.map(escCsv).join(",");
}

export function toCsv(entries: Array<Record<string, unknown>>): string {
  return [CSV_COLUMNS.join(","), ...entries.map(toCsvRow)].join("\n") + "\n";
}

// Short human-readable markdown report attached to the CI step summary
// so on-call can scan first-failures without downloading artifacts.
// Includes valid/invalid counts and (when present) a direct link to the
// quarantine folder holding malformed artifacts.
export function renderMarkdown(summary: {
  matched: number;
  scanned: number;
  valid?: number;
  invalid?: number;
  invalidDir?: string | null;
  filters: Record<string, unknown>;
  entries: Array<Record<string, unknown>>;
}): string {
  const lines: string[] = [];
  const valid = summary.valid ?? summary.entries.filter((e) => !e.failureKind || e.failureKind === "escape").length;
  const invalid = summary.invalid ?? summary.entries.length - valid;
  lines.push(`## Focus-trap inspect summary`);
  lines.push("");
  lines.push(`- matched: **${summary.matched}** / scanned ${summary.scanned}`);
  lines.push(`- artifacts: ✅ valid **${valid}** · ❌ invalid **${invalid}**`);
  if (invalid > 0 && summary.invalidDir) {
    lines.push(`- quarantine folder: [\`${summary.invalidDir}\`](${summary.invalidDir}) (bundled in the CI artifact)`);
  }
  const activeFilters = Object.entries(summary.filters).filter(([, v]) => v != null && v !== "");
  if (activeFilters.length) {
    lines.push(`- filters: ${activeFilters.map(([k, v]) => `\`${k}=${v}\``).join(", ")}`);
  }
  lines.push("");
  if (!summary.entries.length) {
    lines.push("_No matching focus-trap-escape artifacts._");
    return lines.join("\n") + "\n";
  }
  lines.push("| spec | browser | attempt | label | first escape | relocate | failure |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const e of summary.entries) {
    const fe = (e.firstEscape as Record<string, unknown> | null) || null;
    const rl = (e.relocate as Record<string, unknown> | null) || null;
    const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|");
    lines.push(
      `| ${cell(e.spec)} | ${cell(e.browser)} | ${cell(e.attempt)} | ${cell(e.label)} | ${cell(fe ? `${fe.event}@${fe.perf}ms` : "—")} | ${cell(rl ? `${rl.path} (fallback=${rl.usedFallback})` : "—")} | ${cell(e.failureReason || "—")} |`,
    );
  }
  return lines.join("\n") + "\n";
}
