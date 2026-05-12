import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "snote.vim-mode";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Persisted vim-mode preference. The actual `@replit/codemirror-vim`
 * package is loaded lazily by `Editor.tsx` only when this returns true.
 */
export function useVimMode(): { vim: boolean; setVim: (v: boolean) => void; toggleVim: () => void } {
  const [vim, setVimState] = useState<boolean>(() => read());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setVimState(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setVim = useCallback((v: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    setVimState(v);
  }, []);

  const toggleVim = useCallback(() => setVim(!read()), [setVim]);

  return { vim, setVim, toggleVim };
}
