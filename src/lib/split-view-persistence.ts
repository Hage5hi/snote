// Short-lived persistence of the most recent Split view path so the app can
// restore the user's last 2/3/4-slug layout after Home navigation or a quick
// remount. Refresh already restores state from the URL itself; this exists so
// pages that want to jump back into the last split (e.g. a future "Return to
// split view" affordance on Home) don't have to invent their own storage.
//
// Kept in sessionStorage on purpose: it should not survive tab close, matching
// the transient nature of split view sessions.

const KEY = "snote:last-split-view:v1";

export interface LastSplitView {
  path: string; // e.g. "/a+b+c"
  slugs: string[];
  count: number;
  savedAt: number;
}

export function saveLastSplitView(slugs: string[]): void {
  if (typeof window === "undefined") return;
  if (slugs.length < 2 || slugs.length > 4) return;
  try {
    const payload: LastSplitView = {
      path: `/${slugs.join("+")}`,
      slugs,
      count: slugs.length,
      savedAt: Date.now(),
    };
    window.sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage may throw in private mode / quota — safe to ignore.
  }
}

export function loadLastSplitView(): LastSplitView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastSplitView;
    if (
      !parsed ||
      !Array.isArray(parsed.slugs) ||
      parsed.slugs.length < 2 ||
      parsed.slugs.length > 4 ||
      typeof parsed.path !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearLastSplitView(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const LAST_SPLIT_VIEW_STORAGE_KEY = KEY;
