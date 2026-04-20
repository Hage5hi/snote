import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "note.pagination";

function getScroller(): HTMLElement | null {
  return document.querySelector(".cm-scroller") as HTMLElement | null;
}

/** Page size = scroller's clientHeight, with a small overlap for context. */
function pageStep(el: HTMLElement) {
  return Math.max(120, el.clientHeight - 48);
}

export function usePagination() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "1";
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch {}
    document.documentElement.classList.toggle("paginated", enabled);
  }, [enabled]);

  const flip = useCallback((dir: 1 | -1) => {
    const el = getScroller();
    if (!el) return;
    const step = pageStep(el);
    el.scrollBy({ top: step * dir, behavior: "smooth" });
  }, []);

  // Keybindings: PageUp/Down always, Cmd+Arrow when paginated.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Toggle: Cmd/Ctrl + Shift + P
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setEnabled((v) => !v);
        return;
      }
      if (!enabled) return;
      // Don't hijack arrow keys while typing — only when modifier is held.
      if ((e.metaKey || e.ctrlKey) && e.key === "ArrowDown") {
        e.preventDefault();
        flip(1);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "ArrowUp") {
        e.preventDefault();
        flip(-1);
      } else if (e.key === "PageDown") {
        e.preventDefault();
        flip(1);
      } else if (e.key === "PageUp") {
        e.preventDefault();
        flip(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, flip]);

  return { enabled, toggle: () => setEnabled((v) => !v), setEnabled, flip };
}
