import { useCallback, useEffect, useState } from "react";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safe-storage";

// Scroll sync between the editor and the preview pane. Default ON for new
// users; persists per device/browser so users who turn it off stay off.
const KEY = "notes:scroll-sync";

export function useScrollSyncEnabled() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const raw = safeLocalStorageGet(KEY);
    if (raw === null) return true;
    return raw === "1";
  });

  useEffect(() => {
    safeLocalStorageSet(KEY, enabled ? "1" : "0");
  }, [enabled]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);
  return { enabled, toggle };
}
