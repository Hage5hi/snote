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
  original: string;
  sanitized: string;
  removed: string[];
}

export function UrlSanitizeDebugPanel() {
  const location = useLocation();
  const [info, setInfo] = useState<StripInfo | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Enable when running in dev, OR when the explicit env flag is on
  // (VITE_DEBUG_URL_SANITIZE_PANEL=1|true). The explicit flag lets us opt
  // in from a production preview build without shipping the panel to real
  // production users by default.
  const flag = import.meta.env.VITE_DEBUG_URL_SANITIZE_PANEL;
  const enabled = import.meta.env.DEV || flag === "1" || flag === "true";

  useEffect(() => {
    if (!enabled) return;
    const original = `${location.pathname}${location.search}${location.hash}`;
    let captured: StripInfo | null = null;
    sanitizeUrl(original, {
      allowedParams: NOTE_ALLOWED_PARAMS,
      onStrip: (i) => {
        captured = i;
      },
    });
    setInfo(captured);
  }, [enabled, location.pathname, location.search, location.hash]);

  if (!enabled) return null;
  if (!info) return null;

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
    maxWidth: 360,
    pointerEvents: "auto",
  };

  return (
    <div style={style} data-url-sanitize-debug-panel="true" data-removed-count={info.removed.length}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={{ background: "transparent", color: "#ffb", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
      >
        [url] stripped {info.removed.length} param(s) {collapsed ? "▸" : "▾"}
      </button>
      {!collapsed && (
        <div style={{ marginTop: 4, opacity: 0.9, wordBreak: "break-all" }}>
          <div><span style={{ opacity: 0.6 }}>original:</span> {info.original}</div>
          <div><span style={{ opacity: 0.6 }}>sanitized:</span> {info.sanitized}</div>
          <div><span style={{ opacity: 0.6 }}>removed:</span> {info.removed.join(", ")}</div>
        </div>
      )}
    </div>
  );
}
