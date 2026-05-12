import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "snote.vim-mode";
const EVENT_NAME = "snote:vim-mode-change";

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
 *
 * Broadcasts changes via a custom event so multiple consumers in the same
 * window (e.g., Editor + SettingsMenu) stay in sync without prop drilling.
 */
export function useVimMode(): { vim: boolean; setVim: (v: boolean) => void; toggleVim: () => void } {
  const [vim, setVimState] = useState<boolean>(() => read());

  useEffect(() => {
    const sync = () => setVimState(read());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_NAME, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_NAME, sync);
    };
  }, []);

  const setVim = useCallback((v: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    setVimState(v);
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  }, []);

  const toggleVim = useCallback(() => setVim(!read()), [setVim]);

  return { vim, setVim, toggleVim };
}

