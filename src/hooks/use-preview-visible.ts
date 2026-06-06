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

// One-shot guard so we only log/attempt the legacy migration a single time
// per page lifetime. After it runs (success or no-op) we never look at the
// legacy key again, which guarantees no late drift and gives us a clear
// dev-only signal if the migration is unexpectedly re-entered.
let legacyMigrationAttempted = false;
let legacyMigrationRanCount = 0;

export interface PreviewVisibleMetrics {
  migrationAttempted: boolean;
  migrationRan: number;
}

export function getPreviewVisibleMetrics(): PreviewVisibleMetrics {
  return {
    migrationAttempted: legacyMigrationAttempted,
    migrationRan: legacyMigrationRanCount,
  };
}

function tryMigrateLegacyToWide(): boolean | null {
  if (legacyMigrationAttempted) return null;
  legacyMigrationAttempted = true;
  try {
    const legacy = parseStored(window.localStorage.getItem(PREVIEW_KEY_LEGACY));
    if (legacy === null) return null;
    try {
      // Mirror the legacy value into the wide key so subsequent reads use
      // the new key directly. We intentionally do NOT remove the legacy
      // key — user data in localStorage is sacred and must only be cleared
      // by an explicit user action. Leaving it in place is harmless: the
      // one-shot guard above prevents re-migration on the same realm, and
      // `readInitial` always prefers the new key when present.
      window.localStorage.setItem(PREVIEW_KEY_WIDE, legacy ? "1" : "0");
    } catch {
      /* best-effort */
    }
    legacyMigrationRanCount++;
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[preview-visible] migrated legacy key → wide (legacy key preserved)", { value: legacy });
    }
    return legacy;
  } catch {
    return null;
  }
}


function readInitial(narrow: boolean): boolean {
  const defaultForViewport = !narrow;
  if (typeof window === "undefined") return defaultForViewport;
  try {
    const own = parseStored(window.localStorage.getItem(storageKey(narrow)));
    if (own !== null) return own;
  } catch {
    // localStorage unavailable / blocked (private mode, disabled cookies,
    // SecurityError) — fall through to viewport-appropriate default.
    return defaultForViewport;
  }
  // Legacy migration: honor the legacy single key ONLY for the wide
  // viewport. Mobile ignores it entirely so an old accidental ON cannot
  // re-introduce the "preview on mobile by default" bug.
  if (!narrow) {
    const migrated = tryMigrateLegacyToWide();
    if (migrated !== null) return migrated;
  }
  return defaultForViewport;
}

// Test hook: reset the one-shot migration guard so unit tests can exercise
// the migration path repeatedly without reloading the module.
export function __resetPreviewMigrationForTests() {
  legacyMigrationAttempted = false;
  legacyMigrationRanCount = 0;
}

if (typeof window !== "undefined" && import.meta.env?.DEV) {
  const w = window as unknown as { __previewVisibleMetrics?: () => PreviewVisibleMetrics };
  w.__previewVisibleMetrics = getPreviewVisibleMetrics;
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
