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
export const PREVIEW_KEY_WIDE = "notes:preview-visible:wide";
export const PREVIEW_KEY_NARROW = "notes:preview-visible:narrow";
// Legacy single-key storage from before the viewport split. Kept for one
// migration read so existing users don't get reset. Migrated to the wide key
// (and then deleted) on first read so subsequent loads are stable.
export const PREVIEW_KEY_LEGACY = "notes:preview-visible";

function isNarrow(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

function storageKey(narrow: boolean): string {
  return narrow ? PREVIEW_KEY_NARROW : PREVIEW_KEY_WIDE;
}

// Strictly validate stored values: only "1" / "0" count. Anything else (a
// corrupted write, a third-party extension, an old experiment) falls through
// to the viewport-appropriate default rather than silently flipping state.
function parseStored(raw: string | null): boolean | null {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

function readInitial(narrow: boolean): boolean {
  const defaultForViewport = !narrow;
  if (typeof window === "undefined") return defaultForViewport;
  try {
    const own = parseStored(window.localStorage.getItem(storageKey(narrow)));
    if (own !== null) return own;
    // Legacy migration: honor the legacy single key ONLY for the wide
    // viewport. We do NOT apply it to narrow, because the legacy default
    // there might have been an accidental "ON" that we now explicitly want
    // to start as "OFF". Migrate the value into the new key and clear the
    // legacy entry so subsequent reads are stable and the legacy slot can
    // never re-introduce drift later.
    if (!narrow) {
      const legacy = parseStored(window.localStorage.getItem(PREVIEW_KEY_LEGACY));
      if (legacy !== null) {
        try {
          window.localStorage.setItem(PREVIEW_KEY_WIDE, legacy ? "1" : "0");
          window.localStorage.removeItem(PREVIEW_KEY_LEGACY);
        } catch {
          // Best-effort migration — fall through and just return the value.
        }
        return legacy;
      }
    }
  } catch {
    // localStorage unavailable (private mode etc.) — fall through to default.
  }
  return defaultForViewport;
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
