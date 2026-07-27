export type EventKind =
  | "warn"
  | "error"
  | "exception"
  | "unhandledrejection"
  | "react";

export interface DiagEvent {
  id: number;
  at: number;
  kind: EventKind;
  message: string;
  detail?: string;
  /** React componentStack from ErrorBoundary — top-most frame first. */
  componentStack?: string;
}

export const MAX_EXPORT_DETAIL_BYTES = 512;
export const DIAG_EXPORT_SCHEMA_VERSION = 1;

/** Filename: `diagnostics-<iso>.json` with `:`/`.` replaced so it's FS-safe. */
export function diagExportFilename(now: Date = new Date()): string {
  const safe = now.toISOString().replace(/[:.]/g, "-");
  return `diagnostics-${safe}.json`;
}

/** Truncate details for export so downloaded JSON never bloats. Mirrors
 * chrome-extension MAX_TELEMETRY_DETAIL_BYTES. Panel keeps raw data. */
export function truncateDiagEventsForExport(events: DiagEvent[]): DiagEvent[] {
  return events.map((event) => {
    const out: DiagEvent = { ...event };
    for (const key of ["detail", "componentStack"] as const) {
      const value = out[key];
      if (typeof value === "string" && value.length > MAX_EXPORT_DETAIL_BYTES) {
        out[key] =
          `${value.slice(0, MAX_EXPORT_DETAIL_BYTES)}…[truncated ${value.length - MAX_EXPORT_DETAIL_BYTES}b]`;
      }
    }
    return out;
  });
}

/** Pure filter matching the panel display: kind toggle + case-insensitive
 * substring search across message / detail / componentStack. */
export function filterDiagEvents(
  events: DiagEvent[],
  opts: { kind?: "all" | EventKind; query?: string },
): DiagEvent[] {
  const kind = opts.kind ?? "all";
  const query = (opts.query ?? "").trim().toLowerCase();
  return events
    .filter((event) => kind === "all" || event.kind === kind)
    .filter((event) => {
      if (!query) return true;
      return (
        event.message.toLowerCase().includes(query) ||
        (event.detail?.toLowerCase().includes(query) ?? false) ||
        (event.componentStack?.toLowerCase().includes(query) ?? false)
      );
    });
}

