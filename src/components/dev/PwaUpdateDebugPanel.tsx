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

type PwaUpdateDebugState = PwaUpdateReadinessState;

type InvalidStats = {
  total: number;
  lastMinute: number;
  lastHour: number;
  lastAt: number | null;
};

export function PwaUpdateDebugPanel() {
  const [state, setState] = useState<PwaUpdateDebugState | null>(null);
  const [invalid, setInvalid] = useState<PwaReadinessInvalidReason | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [stats, setStats] = useState<InvalidStats>({ total: 0, lastMinute: 0, lastHour: 0, lastAt: null });
  const invalidTimestamps = useRef<number[]>([]);
  const invalidTotal = useRef<number>(0);
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
      // Dedupe: only re-process when the raw state actually changes so we
      // don't spam `snote:pwa-readiness-invalid` every 500ms poll tick.
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

    // Stats: count every `snote:pwa-readiness-invalid` event (from any source,
    // not just our own emit) so staging can eyeball the frequency.
    const onInvalid = () => {
      const now = Date.now();
      invalidTotal.current += 1;
      invalidTimestamps.current.push(now);
      const cutoff = now - 3_600_000;
      invalidTimestamps.current = invalidTimestamps.current.filter((t) => t >= cutoff);
    };
    window.addEventListener(PWA_READINESS_INVALID_EVENT, onInvalid);
    const statsId = window.setInterval(() => {
      const now = Date.now();
      const ts = invalidTimestamps.current;
      const lastMinute = ts.filter((t) => t >= now - 60_000).length;
      const lastHour = ts.length;
      setStats({
        total: invalidTotal.current,
        lastMinute,
        lastHour,
        lastAt: ts.length ? ts[ts.length - 1] : null,
      });
    }, 1000);

    return () => {
      window.clearInterval(id);
      window.clearInterval(statsId);
      window.removeEventListener(PWA_READINESS_INVALID_EVENT, onInvalid);
    };
  }, []);

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

  const statsBlock = (
    <div
      data-pwa-debug-stats="invalid-events"
      data-invalid-total={stats.total}
      data-invalid-last-minute={stats.lastMinute}
      data-invalid-last-hour={stats.lastHour}
      style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.15)", opacity: 0.75 }}
    >
      invalid events — total: {stats.total} · 1m: {stats.lastMinute} · 1h: {stats.lastHour}
      {stats.lastAt ? ` · last: ${Math.round((Date.now() - stats.lastAt) / 1000)}s ago` : ""}
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
    </div>
  );
}
