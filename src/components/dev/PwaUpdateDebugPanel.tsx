// Dev-only debug panel showing current vs pending buildId + reload strategy.
// Mounted only when import.meta.env.DEV is true. Reads
// window.__SNOTE_PWA_UPDATE_STATE__ every 500ms.
//
// Not shown in production builds and not shown in Lovable preview (the pwa
// updater short-circuits there anyway, so the state never populates).

import { useEffect, useState } from "react";
import {
  exposeReadinessValidatorForE2E,
  validatePwaReadinessState,
  type PwaUpdateReadinessState,
} from "@/lib/pwa-update-readiness";

type PwaUpdateDebugState = PwaUpdateReadinessState;

export function PwaUpdateDebugPanel() {
  const [state, setState] = useState<PwaUpdateDebugState | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeReadinessValidatorForE2E();
    const read = () => {
      const raw = (window as unknown as { __SNOTE_PWA_UPDATE_STATE__?: unknown }).__SNOTE_PWA_UPDATE_STATE__;
      setState(validatePwaReadinessState(raw) ? raw : null);
    };
    read();
    const id = window.setInterval(read, 500);
    return () => window.clearInterval(id);
  }, []);

  if (!import.meta.env.DEV || !state) return null;

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

  return (
    <div style={style} data-pwa-debug-panel="true">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={{ background: "transparent", color: "#fff", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
      >
        [pwa] {state.currentBuildId} → {state.pendingBuildId ?? "—"} {state.updateAvailable ? "●" : ""} {collapsed ? "▸" : "▾"}
      </button>
      {!collapsed && (
        <div style={{ marginTop: 4, opacity: 0.85 }}>
          <div>current: {state.currentBuildId}</div>
          <div>pending: {state.pendingBuildId ?? "—"}</div>
          <div>strategy: {state.reloadStrategy ?? "—"}</div>
          <div>attempts: {state.reloadAttemptCount}</div>
          <div>last remote: {state.lastRemoteBuildId ?? "—"}</div>
          <div>inProgress: {String(state.updateInProgress)}</div>
        </div>
      )}
    </div>
  );
}
