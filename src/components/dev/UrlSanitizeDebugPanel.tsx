// Dev-only panel showing the original vs sanitized URL for the current note
// route, including which query params would be stripped by `sanitizeUrl`.
// Not mounted in production. Purely observational — does NOT rewrite the URL.

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { sanitizeUrl } from "@/lib/url-sanitize";

// Query params allowed to survive on note routes. Keep in sync with the
// whitelist enforced by the PWA update smoke tests.
const NOTE_ALLOWED_PARAMS = ["foo", "tag", "q", "page"];

interface StripInfo {
  at: number;
  original: string;
  sanitized: string;
  removed: string[];
}

const MAX_HISTORY = 20;

export function UrlSanitizeDebugPanel() {
  const location = useLocation();
  const [history, setHistory] = useState<StripInfo[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  const flag = import.meta.env.VITE_DEBUG_URL_SANITIZE_PANEL;
  const enabled = import.meta.env.DEV || flag === "1" || flag === "true";

  useEffect(() => {
    if (!enabled) return;
    const original = `${location.pathname}${location.search}${location.hash}`;
    sanitizeUrl(original, {
      allowedParams: NOTE_ALLOWED_PARAMS,
      onStrip: (i) => {
        const event: StripInfo = { at: Date.now(), ...i };
        // Structured trace event — mirrors what the panel renders so it can
        // be grepped from console logs or captured by Playwright.
        console.info("[url-sanitize:event]", event);
        setHistory((prev) => [event, ...prev].slice(0, MAX_HISTORY));
      },
    });
  }, [enabled, location.pathname, location.search, location.hash]);

  if (!enabled) return null;
  if (history.length === 0) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    left: 8,
    bottom: 8,
    zIndex: 99999,
    background: "rgba(0,0,0,0.82)",
    color: "#fff",
    font: "11px/1.4 ui-monospace,monospace",
    padding: "6px 8px",
    borderRadius: 4,
    maxWidth: 420,
    maxHeight: "50vh",
    overflow: "auto",
    pointerEvents: "auto",
  };

  return (
    <div style={style} data-url-sanitize-debug-panel="true" data-event-count={history.length}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={{ background: "transparent", color: "#ffb", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
      >
        [url] {history.length} strip event(s) {collapsed ? "▸" : "▾"}
      </button>
      {!collapsed && (
        <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none" }}>
          {history.map((info, idx) => (
            <li
              key={`${info.at}-${idx}`}
              data-strip-event
              style={{ marginTop: 4, paddingTop: 4, borderTop: idx === 0 ? 0 : "1px solid rgba(255,255,255,0.15)", wordBreak: "break-all" }}
            >
              <div><span style={{ opacity: 0.6 }}>original:</span> {info.original}</div>
              <div><span style={{ opacity: 0.6 }}>sanitized:</span> {info.sanitized}</div>
              <div><span style={{ opacity: 0.6 }}>removed:</span> {info.removed.join(", ")}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
