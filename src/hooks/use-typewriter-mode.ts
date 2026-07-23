import { useCallback, useEffect, useState } from "react";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safe-storage";

const KEY = "notes:typewriter-mode";

export function useTypewriterMode() {
  const [typewriter, setTypewriter] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return safeLocalStorageGet(KEY) === "1";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (typewriter) root.classList.add("typewriter-mode");
    else root.classList.remove("typewriter-mode");
    safeLocalStorageSet(KEY, typewriter ? "1" : "0");
  }, [typewriter]);

  // F9 keyboard shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F9") {
        e.preventDefault();
        setTypewriter((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = useCallback(() => setTypewriter((v) => !v), []);
  return { typewriter, toggle, setTypewriter };
}
