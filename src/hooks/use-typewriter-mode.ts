import { useCallback, useEffect, useState } from "react";

const KEY = "notes:typewriter-mode";

export function useTypewriterMode() {
  const [typewriter, setTypewriter] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(KEY) === "1";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (typewriter) root.classList.add("typewriter-mode");
    else root.classList.remove("typewriter-mode");
    window.localStorage.setItem(KEY, typewriter ? "1" : "0");
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
