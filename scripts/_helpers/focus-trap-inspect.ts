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

// Minimal schema validator — no external deps. Returns [] when the
// payload matches the shape produced by e2e/helpers/install-prompt.ts,
// otherwise a list of human-readable error strings. Callers should
// fail fast so a malformed artifact never silently degrades inspect
// or replay output.
export function validateFocusTrapPayload(input: unknown): string[] {
  const errs: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return ["payload: expected top-level object"];
  }
  const p = input as Record<string, unknown>;
  if (!Array.isArray(p.focusHistory)) {
    errs.push("focusHistory: required array");
  } else {
    p.focusHistory.forEach((e, i) => {
      if (!e || typeof e !== "object") {
        errs.push(`focusHistory[${i}]: expected object`);
        return;
      }
      const ev = (e as Record<string, unknown>).event;
      if (typeof ev !== "string") errs.push(`focusHistory[${i}].event: expected string`);
    });
  }
  if (p.iterTimings != null && (typeof p.iterTimings !== "object" || Array.isArray(p.iterTimings))) {
    errs.push("iterTimings: expected object when present");
  }
  if (p.artifacts != null && (typeof p.artifacts !== "object" || Array.isArray(p.artifacts))) {
    errs.push("artifacts: expected object when present");
  }
  return errs;
}

// CSV column ordering is part of the CI contract — downstream jobs
// index by column position. Do not reorder without updating consumers.
export const CSV_COLUMNS = [
  "file", "spec", "browser", "attempt", "label", "testTitle",
  "firstEscapeEvent", "firstEscapePerfMs",
  "relocatePath", "relocateUsedFallback",
  "iterCount",
] as const;

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
  ];
  return values.map(escCsv).join(",");
}

export function toCsv(entries: Array<Record<string, unknown>>): string {
  return [CSV_COLUMNS.join(","), ...entries.map(toCsvRow)].join("\n") + "\n";
}

// Short human-readable markdown report attached to the CI step summary
// so on-call can scan first-failures without downloading artifacts.
export function renderMarkdown(summary: {
  matched: number;
  scanned: number;
  filters: Record<string, unknown>;
  entries: Array<Record<string, unknown>>;
}): string {
  const lines: string[] = [];
  lines.push(`## Focus-trap inspect summary`);
  lines.push("");
  lines.push(`- matched: **${summary.matched}** / scanned ${summary.scanned}`);
  const activeFilters = Object.entries(summary.filters).filter(([, v]) => v != null && v !== "");
  if (activeFilters.length) {
    lines.push(`- filters: ${activeFilters.map(([k, v]) => `\`${k}=${v}\``).join(", ")}`);
  }
  lines.push("");
  if (!summary.entries.length) {
    lines.push("_No matching focus-trap-escape artifacts._");
    return lines.join("\n") + "\n";
  }
  lines.push("| spec | browser | attempt | label | first escape | relocate |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const e of summary.entries) {
    const fe = (e.firstEscape as Record<string, unknown> | null) || null;
    const rl = (e.relocate as Record<string, unknown> | null) || null;
    const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|");
    lines.push(
      `| ${cell(e.spec)} | ${cell(e.browser)} | ${cell(e.attempt)} | ${cell(e.label)} | ${cell(fe ? `${fe.event}@${fe.perf}ms` : "—")} | ${cell(rl ? `${rl.path} (fallback=${rl.usedFallback})` : "—")} |`,
    );
  }
  return lines.join("\n") + "\n";
}
