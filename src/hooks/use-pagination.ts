import { useCallback, useEffect, useState } from "react";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safe-storage";

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
    return safeLocalStorageGet(STORAGE_KEY) === "1";
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    safeLocalStorageSet(STORAGE_KEY, enabled ? "1" : "0");
    document.documentElement.classList.toggle("paginated", enabled);
  }, [enabled]);

  const flip = useCallback((dir: 1 | -1) => {
    const el = getScroller();
    if (!el) return;
    const step = pageStep(el);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ top: step * dir, behavior: reducedMotion ? "auto" : "smooth" });
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

  // Track current page / total pages while pagination is on.
  useEffect(() => {
    if (!enabled) {
      setPage(1);
      setTotalPages(1);
      return;
    }

    let raf = 0;
    let scroller: HTMLElement | null = null;
    let resizeObs: ResizeObserver | null = null;
    let mutObs: MutationObserver | null = null;
    let attachTimer: number | null = null;

    const recompute = () => {
      const el = scroller ?? getScroller();
      if (!el) return;
      const step = pageStep(el);
      const total = Math.max(1, Math.ceil((el.scrollHeight - 1) / step));
      const current = Math.min(total, Math.max(1, Math.round(el.scrollTop / step) + 1));
      setTotalPages(total);
      setPage(current);
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    };

    // Wait for the CodeMirror scroller to mount.
    let tries = 0;
    const attach = () => {
      scroller = getScroller();
      if (!scroller) {
        if (tries++ < 30) {
          attachTimer = window.setTimeout(attach, 100);
        }
        return;
      }
      scroller.addEventListener("scroll", schedule, { passive: true });
      resizeObs = new ResizeObserver(schedule);
      resizeObs.observe(scroller);
      mutObs = new MutationObserver(schedule);
      mutObs.observe(scroller, { childList: true, subtree: true, characterData: true });
      recompute();
    };
    attach();

    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      if (attachTimer !== null) window.clearTimeout(attachTimer);
      window.removeEventListener("resize", schedule);
      scroller?.removeEventListener("scroll", schedule);
      resizeObs?.disconnect();
      mutObs?.disconnect();
    };
  }, [enabled]);

  return {
    enabled,
    toggle: () => setEnabled((v) => !v),
    setEnabled,
    flip,
    page,
    totalPages,
  };
}
