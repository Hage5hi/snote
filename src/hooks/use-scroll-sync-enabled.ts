import { useCallback, useEffect, useState } from "react";

// Scroll sync between the editor and the preview pane. Default ON for new
// users; persists per device/browser so users who turn it off stay off.
const KEY = "notes:scroll-sync";

export function useScrollSyncEnabled() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return true;
    return raw === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(KEY, enabled ? "1" : "0");
  }, [enabled]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);
  return { enabled, toggle };
}
