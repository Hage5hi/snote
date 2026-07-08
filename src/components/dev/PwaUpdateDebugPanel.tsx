// Dev-only debug panel showing current vs pending buildId + reload strategy.
// Mounted only when import.meta.env.DEV is true. Reads
// window.__SNOTE_PWA_UPDATE_STATE__ every 500ms.
//
// Not shown in production builds and not shown in Lovable preview (the pwa
// updater short-circuits there anyway, so the state never populates).

import { useEffect, useRef, useState } from "react";
import {
  emitPwaReadinessInvalidEvent,
  explainPwaReadinessState,
  exposeReadinessValidatorForE2E,
  PWA_READINESS_INVALID_EVENT,
  validatePwaReadinessState,
  type PwaReadinessInvalidReason,
  type PwaUpdateReadinessState,
} from "@/lib/pwa-update-readiness";
import {
  computeInvalidStats,
  invalidStatsToCsv,
  loadPersistedInvalidStats,
  pruneInvalidTimestamps,
  savePersistedInvalidStats,
  type InvalidStats,
  type InvalidStatsWindow,
} from "@/lib/pwa-invalid-stats";

type PwaUpdateDebugState = PwaUpdateReadinessState;

const WINDOW_OPTIONS: InvalidStatsWindow[] = ["5m", "1h", "24h"];

// Module-level guard so remounts (React StrictMode double-invoke, HMR)
// cannot double-register the `snote:pwa-readiness-invalid` listener and
// double-count events into the shared timestamp buffer.
let invalidListenerRefCount = 0;
let invalidListenerHandler: ((e: Event) => void) | null = null;
const invalidTimestampsBuffer: number[] = [];
let invalidTotalCount = 0;
const invalidSubscribers = new Set<() => void>();

function ensureInvalidListenerInstalled() {
  invalidListenerRefCount += 1;
  if (invalidListenerHandler) return;
  invalidListenerHandler = () => {
    const now = Date.now();
    invalidTotalCount += 1;
    invalidTimestampsBuffer.push(now);
    const pruned = pruneInvalidTimestamps(invalidTimestampsBuffer, now);
    if (pruned.length !== invalidTimestampsBuffer.length) {
      invalidTimestampsBuffer.length = 0;
      invalidTimestampsBuffer.push(...pruned);
    }
    invalidSubscribers.forEach((fn) => fn());
  };
  window.addEventListener(PWA_READINESS_INVALID_EVENT, invalidListenerHandler);
}

function releaseInvalidListener() {
  invalidListenerRefCount = Math.max(0, invalidListenerRefCount - 1);
  if (invalidListenerRefCount === 0 && invalidListenerHandler) {
    window.removeEventListener(PWA_READINESS_INVALID_EVENT, invalidListenerHandler);
    invalidListenerHandler = null;
  }
}

export function PwaUpdateDebugPanel() {
  const [state, setState] = useState<PwaUpdateDebugState | null>(null);
  const [invalid, setInvalid] = useState<PwaReadinessInvalidReason | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [statsWindow, setStatsWindow] = useState<InvalidStatsWindow>("1h");
  const [stats, setStats] = useState<InvalidStats>(() =>
    computeInvalidStats(invalidTimestampsBuffer, invalidTotalCount, Date.now(), "1h"),
  );
  const lastEmitKey = useRef<string | null>(null);
  const lastRawKey = useRef<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeReadinessValidatorForE2E();
    const read = () => {
      let raw: unknown;
      try {
        raw = (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__;
      } catch {
        setState(null);
        setInvalid(null);
        return;
      }
      let rawKey: string;
      try {
        rawKey = raw === undefined ? "\0undef" : JSON.stringify(raw) ?? "\0nonjson";
      } catch {
        rawKey = "\0circular";
      }
      if (rawKey === lastRawKey.current) return;
      lastRawKey.current = rawKey;

      try {
        if (validatePwaReadinessState(raw)) {
          lastEmitKey.current = null;
          setInvalid(null);
          setState(raw);
        } else {
          const reason = raw !== undefined && raw !== null ? explainPwaReadinessState(raw) : null;
          if (reason) {
            const key = `${reason.field}|${reason.reason}|${reason.received}`;
            if (key !== lastEmitKey.current) {
              lastEmitKey.current = key;
              emitPwaReadinessInvalidEvent(raw);
            }
          } else {
            lastEmitKey.current = null;
          }
          setInvalid(reason);
          setState(null);
        }
      } catch {
        try {
          window.dispatchEvent(
            new CustomEvent("snote:pwa-readiness-invalid", {
              detail: { field: "<root>", path: "<root>", reason: "validator-threw", received: typeof raw },
            }),
          );
        } catch {
          /* ignore */
        }
        setInvalid({ field: "<root>", path: "<root>", reason: "validator-threw", received: typeof raw });
        setState(null);
      }
    };
    read();
    const id = window.setInterval(read, 500);
    return () => window.clearInterval(id);
  }, []);

  // Stats subscription — uses module-level ref-counted listener so remounts
  // cannot double-count events into the shared timestamps buffer.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    ensureInvalidListenerInstalled();
    const recompute = () => {
      setStats(computeInvalidStats(invalidTimestampsBuffer, invalidTotalCount, Date.now(), statsWindow));
    };
    invalidSubscribers.add(recompute);
    recompute();
    const tickId = window.setInterval(recompute, 1000);
    return () => {
      window.clearInterval(tickId);
      invalidSubscribers.delete(recompute);
      releaseInvalidListener();
    };
  }, [statsWindow]);

  if (!import.meta.env.DEV) return null;
  if (!state && !invalid) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    right: 8,
    bottom: 8,
    zIndex: 99999,
    background: "rgba(0,0,0,0.82)",
    color: "#fff",
    font: "11px/1.4 ui-monospace,monospace",
    padding: "6px 8px",
    borderRadius: 4,
    maxWidth: 320,
    pointerEvents: "auto",
  };

  const btnStyle: React.CSSProperties = {
    background: "transparent",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.25)",
    borderRadius: 3,
    padding: "1px 5px",
    cursor: "pointer",
    font: "inherit",
    marginLeft: 4,
  };

  const activeBtnStyle: React.CSSProperties = { ...btnStyle, background: "rgba(255,255,255,0.18)" };

  const handleExportCsv = () => {
    try {
      const now = Date.now();
      const snapshot = pruneInvalidTimestamps(invalidTimestampsBuffer, now);
      const csv = invalidStatsToCsv(
        computeInvalidStats(snapshot, invalidTotalCount, now, statsWindow),
        snapshot,
        now,
      );
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pwa-readiness-invalid-${new Date(now).toISOString().replace(/[:.]/g, "-")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.warn("[pwa] stats CSV export failed", e);
    }
  };

  const statsBlock = (
    <div
      data-pwa-debug-stats="invalid-events"
      data-invalid-total={stats.total}
      data-invalid-last-minute={stats.lastMinute}
      data-invalid-window={stats.window}
      data-invalid-window-count={stats.windowCount}
      style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.15)", opacity: 0.85 }}
    >
      <div>
        invalid events — total: {stats.total} · 1m: {stats.lastMinute} · {stats.window}: {stats.windowCount}
        {stats.lastAt ? ` · last: ${Math.round((Date.now() - stats.lastAt) / 1000)}s ago` : ""}
      </div>
      <div style={{ marginTop: 3, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ opacity: 0.7 }}>window:</span>
        {WINDOW_OPTIONS.map((w) => (
          <button
            key={w}
            type="button"
            data-pwa-debug-stats-window={w}
            aria-pressed={statsWindow === w}
            onClick={() => setStatsWindow(w)}
            style={statsWindow === w ? activeBtnStyle : btnStyle}
          >
            {w}
          </button>
        ))}
        <button
          type="button"
          data-pwa-debug-stats-export="csv"
          onClick={handleExportCsv}
          style={{ ...btnStyle, marginLeft: "auto" }}
        >
          export csv
        </button>
      </div>
    </div>
  );

  if (invalid) {
    return (
      <div style={style} data-pwa-debug-panel="invalid" data-invalid-field={invalid.field}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{ background: "transparent", color: "#f88", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
        >
          [pwa] invalid readiness ⚠ {collapsed ? "▸" : "▾"}
        </button>
        {!collapsed && (
          <ol style={{ margin: "4px 0 0", paddingLeft: 16, opacity: 0.9 }}>
            <li data-invalid-row="0">
              <code>{invalid.path}</code>: {invalid.reason}{" "}
              <span style={{ opacity: 0.7 }}>(received: {invalid.received})</span>
            </li>
          </ol>
        )}
        {!collapsed && statsBlock}
      </div>
    );
  }

  return (
    <div style={style} data-pwa-debug-panel="true">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={{ background: "transparent", color: "#fff", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
      >
        [pwa] {state!.currentBuildId} → {state!.pendingBuildId ?? "—"} {state!.updateAvailable ? "●" : ""} {collapsed ? "▸" : "▾"}
      </button>
      {!collapsed && (
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          <div>current: {state!.currentBuildId}</div>
          <div>pending: {state!.pendingBuildId ?? "—"}</div>
          <div>strategy: {state!.reloadStrategy ?? "—"}</div>
          <div>attempts: {state!.reloadAttemptCount}</div>
          <div>last remote: {state!.lastRemoteBuildId ?? "—"}</div>
          <div>inProgress: {String(state!.updateInProgress)}</div>
        </div>
      )}
      {!collapsed && statsBlock}
    </div>
  );
}
