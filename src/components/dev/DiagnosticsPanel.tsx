// Dev-only in-app diagnostics panel that captures:
//   - console.warn / console.error calls (patches the methods, restores on unmount)
//   - window "error" events (uncaught exceptions)
//   - window "unhandledrejection" events (async errors)
//   - React render errors via <RuntimeErrorBoundary> exposing `componentStack`
//
// Not mounted in production. Toggle in dev with:
//   VITE_DEBUG_DIAGNOSTICS_PANEL=1 bun run dev
// or unconditionally in DEV builds (default).
//
// Purely observational. Never rewrites state, never swallows the error —
// re-throws / re-invokes original console methods so existing error paths
// (Sentry, PWA update overlay, unit tests) still see everything.

import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type PropsWithChildren,
  type ReactNode,
} from "react";

type EventKind = "warn" | "error" | "exception" | "unhandledrejection" | "react";

interface DiagEvent {
  id: number;
  at: number;
  kind: EventKind;
  message: string;
  detail?: string;
  /** React componentStack from ErrorBoundary — top-most frame first. */
  componentStack?: string;
}

const MAX_EVENTS = 50;
let seq = 0;

/**
 * Global bus so RuntimeErrorBoundary (mounted higher in the tree) can push
 * events into the panel without prop-drilling. Kept intentionally tiny —
 * a single subscriber list, no dependency injection.
 */
type Listener = (e: DiagEvent) => void;
const listeners = new Set<Listener>();
function emit(kind: EventKind, message: string, detail?: string, componentStack?: string) {
  const evt: DiagEvent = {
    id: ++seq,
    at: Date.now(),
    kind,
    message: String(message).slice(0, 500),
    detail: detail ? String(detail).slice(0, 2000) : undefined,
    componentStack: componentStack ? componentStack.slice(0, 2000) : undefined,
  };
  for (const l of listeners) {
    try {
      l(evt);
    } catch {
      /* listener errors must not re-enter the bus */
    }
  }
}

/** Public API: wrap subtrees whose render errors should surface in the panel. */
export class RuntimeErrorBoundary extends Component<
  PropsWithChildren<{ fallback?: ReactNode }>,
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    emit(
      "react",
      error.message || String(error),
      error.stack,
      info.componentStack ?? undefined,
    );
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div
            role="alert"
            style={{
              padding: 12,
              border: "1px solid #f88",
              background: "#fff5f5",
              color: "#900",
              font: "12px/1.4 ui-monospace,monospace",
            }}
          >
            Render error: {this.state.error.message}
          </div>
        )
      );
    }
    return this.props.children;
  }
}

function useDiagnosticsEnabled(): boolean {
  const flag = import.meta.env.VITE_DEBUG_DIAGNOSTICS_PANEL;
  return import.meta.env.DEV || flag === "1" || flag === "true";
}

const MAX_EXPORT_DETAIL_BYTES = 512;
export const DIAG_EXPORT_SCHEMA_VERSION = 1;

/** Filename: `diagnostics-<iso>.json` with `:`/`.` replaced so it's FS-safe. */
export function diagExportFilename(now: Date = new Date()): string {
  const safe = now.toISOString().replace(/[:.]/g, "-");
  return `diagnostics-${safe}.json`;
}

/** Truncate details for export so downloaded JSON never bloats. Mirrors
 *  chrome-extension MAX_TELEMETRY_DETAIL_BYTES. Panel keeps raw data. */
export function truncateDiagEventsForExport(events: DiagEvent[]): DiagEvent[] {
  return events.map((e) => {
    const out: DiagEvent = { ...e };
    for (const key of ["detail", "componentStack"] as const) {
      const v = out[key];
      if (typeof v === "string" && v.length > MAX_EXPORT_DETAIL_BYTES) {
        out[key] = `${v.slice(0, MAX_EXPORT_DETAIL_BYTES)}…[truncated ${v.length - MAX_EXPORT_DETAIL_BYTES}b]`;
      }
    }
    return out;
  });
}

type KindFilter = "all" | EventKind;

export function DiagnosticsPanel() {
  const enabled = useDiagnosticsEnabled();
  const [events, setEvents] = useState<DiagEvent[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const originalConsole = useRef<{ warn?: typeof console.warn; error?: typeof console.error }>({});

  useEffect(() => {
    if (!enabled) return;

    // 1) Subscribe to bus.
    const listener: Listener = (e) =>
      setEvents((prev) => [e, ...prev].slice(0, MAX_EVENTS));
    listeners.add(listener);

    // 2) Patch console.warn/error. Original is invoked FIRST so tests /
    // Sentry / existing consumers see the message unchanged.
    originalConsole.current.warn = console.warn;
    originalConsole.current.error = console.error;
    console.warn = (...args: unknown[]) => {
      originalConsole.current.warn?.apply(console, args);
      emit("warn", stringifyFirst(args), stringifyRest(args));
    };
    console.error = (...args: unknown[]) => {
      originalConsole.current.error?.apply(console, args);
      emit("error", stringifyFirst(args), stringifyRest(args));
    };

    // 3) Uncaught runtime errors.
    const onError = (ev: ErrorEvent) => {
      emit(
        "exception",
        ev.message || "uncaught error",
        [ev.filename && `${ev.filename}:${ev.lineno}:${ev.colno}`, ev.error?.stack]
          .filter(Boolean)
          .join("\n"),
      );
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason;
      emit(
        "unhandledrejection",
        reason?.message || String(reason || "unhandled rejection"),
        reason?.stack,
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      listeners.delete(listener);
      if (originalConsole.current.warn) console.warn = originalConsole.current.warn;
      if (originalConsole.current.error) console.error = originalConsole.current.error;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [enabled]);

  const counts = useMemo(() => {
    const c = { warn: 0, error: 0, exception: 0, unhandledrejection: 0, react: 0 } as Record<
      EventKind,
      number
    >;
    for (const e of events) c[e.kind]++;
    return c;
  }, [events]);

  if (!enabled) return null;

  const total = events.length;
  const badge =
    counts.error + counts.exception + counts.unhandledrejection + counts.react > 0
      ? "#f66"
      : counts.warn > 0
      ? "#fb3"
      : "#6c6";

  return (
    <div
      data-diagnostics-panel="true"
      data-event-count={total}
      data-error-count={counts.error + counts.exception + counts.unhandledrejection + counts.react}
      data-warn-count={counts.warn}
      style={{
        position: "fixed",
        right: 8,
        bottom: 8,
        zIndex: 99999,
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        font: "11px/1.4 ui-monospace,monospace",
        padding: "6px 8px",
        borderRadius: 4,
        maxWidth: 460,
        maxHeight: "60vh",
        overflow: "auto",
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={{
          background: "transparent",
          border: 0,
          color: "#fff",
          padding: 0,
          cursor: "pointer",
          font: "inherit",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ display: "inline-block", width: 8, height: 8, background: badge, borderRadius: "50%" }} />
        [diag] {total} event(s) — err {counts.error + counts.exception + counts.unhandledrejection + counts.react}, warn {counts.warn}, react {counts.react} {collapsed ? "▸" : "▾"}
      </button>
      {!collapsed && (
        <>
          <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setEvents([])}
              style={{ background: "transparent", border: "1px solid #666", color: "#fff", padding: "2px 6px", cursor: "pointer", font: "inherit" }}
            >
              clear
            </button>
            <button
              type="button"
              data-diag-export
              onClick={() => {
                const now = new Date();
                const payload = {
                  schemaVersion: DIAG_EXPORT_SCHEMA_VERSION,
                  exportedAt: now.toISOString(),
                  count: events.length,
                  maxDetailBytes: MAX_EXPORT_DETAIL_BYTES,
                  events: truncateDiagEventsForExport(events),
                };
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = diagExportFilename(now);
                a.click();
                URL.revokeObjectURL(a.href);
              }}
              style={{ background: "transparent", border: "1px solid #666", color: "#fff", padding: "2px 6px", cursor: "pointer", font: "inherit" }}
            >
              export JSON
            </button>
            <select
              data-diag-filter
              value={filter}
              onChange={(ev) => setFilter(ev.target.value as KindFilter)}
              style={{ background: "#111", border: "1px solid #666", color: "#fff", padding: "1px 4px", font: "inherit" }}
            >
              <option value="all">all ({total})</option>
              <option value="warn">warn ({counts.warn})</option>
              <option value="error">error ({counts.error})</option>
              <option value="exception">exception ({counts.exception})</option>
              <option value="unhandledrejection">rejection ({counts.unhandledrejection})</option>
              <option value="react">react ({counts.react})</option>
            </select>
            {(["warn", "error", "exception"] as const).map((k) => {
              const active = filter === k;
              return (
                <button
                  key={k}
                  type="button"
                  data-diag-quickfilter={k}
                  data-active={active}
                  onClick={() => setFilter(active ? "all" : k)}
                  style={{
                    background: active ? KIND_COLORS[k] : "transparent",
                    color: active ? "#000" : KIND_COLORS[k],
                    border: `1px solid ${KIND_COLORS[k]}`,
                    padding: "1px 6px",
                    cursor: "pointer",
                    font: "inherit",
                    borderRadius: 3,
                  }}
                >
                  {k} {counts[k]}
                </button>
              );
            })}
            <input
              data-diag-search
              type="search"
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="search message/detail/stack"
              style={{ background: "#111", border: "1px solid #666", color: "#fff", padding: "1px 4px", font: "inherit", flex: "1 1 140px", minWidth: 100 }}
            />
          </div>
          <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none" }}>
            {events
              .filter((e) => filter === "all" || e.kind === filter)
              .filter((e) => {
                const q = query.trim().toLowerCase();
                if (!q) return true;
                return (
                  e.message.toLowerCase().includes(q) ||
                  (e.detail?.toLowerCase().includes(q) ?? false) ||
                  (e.componentStack?.toLowerCase().includes(q) ?? false)
                );
              })
              .map((e) => {
              const isOpen = expandedId === e.id;
              return (
                <li
                  key={e.id}
                  data-diag-event
                  data-diag-kind={e.kind}
                  style={{
                    marginTop: 4,
                    paddingTop: 4,
                    borderTop: "1px solid rgba(255,255,255,0.15)",
                    wordBreak: "break-word",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : e.id)}
                    style={{
                      background: "transparent",
                      border: 0,
                      color: KIND_COLORS[e.kind],
                      padding: 0,
                      cursor: "pointer",
                      font: "inherit",
                      textAlign: "left",
                      width: "100%",
                    }}
                  >
                    <span style={{ opacity: 0.6 }}>{new Date(e.at).toISOString().slice(11, 19)}</span>{" "}
                    <strong>{e.kind}</strong>: {e.message}
                  </button>
                  {isOpen && (e.detail || e.componentStack) && (
                    <div style={{ marginTop: 2, padding: 4, background: "rgba(255,255,255,0.05)" }}>
                      {e.componentStack && (
                        <>
                          <div style={{ opacity: 0.6 }}>component tree:</div>
                          <pre data-diag-component-stack style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                            {e.componentStack.trim()}
                          </pre>
                        </>
                      )}
                      {e.detail && (
                        <>
                          <div style={{ opacity: 0.6, marginTop: e.componentStack ? 4 : 0 }}>detail:</div>
                          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{e.detail}</pre>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

const KIND_COLORS: Record<EventKind, string> = {
  warn: "#fb3",
  error: "#f66",
  exception: "#f66",
  unhandledrejection: "#f88",
  react: "#f9c",
};

function stringifyFirst(args: unknown[]): string {
  if (args.length === 0) return "";
  const a = args[0];
  if (a instanceof Error) return a.message;
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function stringifyRest(args: unknown[]): string | undefined {
  if (args.length <= 1) {
    const first = args[0];
    return first instanceof Error ? first.stack : undefined;
  }
  return args
    .slice(1)
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join("\n");
}
