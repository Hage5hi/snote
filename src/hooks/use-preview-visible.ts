import { useCallback, useEffect, useState } from "react";

// Persist the preview-pane visibility per viewport class so resizing or
// switching devices doesn't bleed state across form factors.
//
// We keep two independent keys:
//   - `notes:preview-visible:wide`   — for viewports ≥ 900 px
//   - `notes:preview-visible:narrow` — for viewports <  900 px
//
// First-visit defaults:
//   - Wide:   preview ON  (both panes fit side-by-side).
//   - Narrow: preview OFF (one pane at a time; new note has nothing to render).
//
// After the first toggle the stored "1"/"0" wins WITHIN that viewport class
// only. F5 on mobile re-reads the narrow key; F5 on desktop re-reads the wide
// key. This guarantees the requested default (desktop on / mobile off) is
// never "remembered wrong" because the user once toggled on the other device.
const NARROW_QUERY = "(max-width: 899px)";
const KEY_WIDE = "notes:preview-visible:wide";
const KEY_NARROW = "notes:preview-visible:narrow";
// Legacy single-key storage from before the viewport split. Kept for one
// migration read so existing users don't get reset.
const LEGACY_KEY = "notes:preview-visible";

function isNarrow(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

function storageKey(narrow: boolean): string {
  return narrow ? KEY_NARROW : KEY_WIDE;
}

function readInitial(narrow: boolean): boolean {
  if (typeof window === "undefined") return !narrow;
  try {
    const raw = window.localStorage.getItem(storageKey(narrow));
    if (raw !== null) return raw === "1";
    // One-time migration: honor the legacy single key ONLY for the wide
    // viewport. We do NOT apply it to narrow, because the legacy default
    // there might have been an accidental "ON" that we now explicitly want
    // to start as "OFF".
    if (!narrow) {
      const legacy = window.localStorage.getItem(LEGACY_KEY);
      if (legacy !== null) return legacy === "1";
    }
  } catch {
    // localStorage unavailable (private mode etc.) — fall through to default.
  }
  return !narrow;
}

export function usePreviewVisible() {
  const [narrow, setNarrow] = useState<boolean>(isNarrow);
  const [visible, setVisible] = useState<boolean>(() => readInitial(isNarrow()));

  // Track viewport changes so a resize across the 900 px boundary swaps to
  // that viewport's remembered state instead of carrying the other one.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(NARROW_QUERY);
    const onChange = () => {
      const next = mql.matches;
      setNarrow(next);
      setVisible(readInitial(next));
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Persist under the key matching the CURRENT viewport class.
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(narrow), visible ? "1" : "0");
    } catch {
      // Ignore quota / private-mode errors — in-memory state still works.
    }
  }, [visible, narrow]);

  const toggle = useCallback(() => setVisible((v) => !v), []);
  return { visible, toggle, setVisible };
}
