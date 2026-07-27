import { useCallback, useEffect, useState } from "react";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safe-storage";

const KEY = "notes:zen-mode";

export function useZenMode() {
  const [zen, setZen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return safeLocalStorageGet(KEY) === "1";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (zen) root.classList.add("zen-mode");
    else root.classList.remove("zen-mode");
    safeLocalStorageSet(KEY, zen ? "1" : "0");
  }, [zen]);

  // F11 keyboard shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        setZen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = useCallback(() => setZen((v) => !v), []);
  return { zen, toggle, setZen };
}
