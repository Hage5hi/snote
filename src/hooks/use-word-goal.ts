// Per-slug word count goal, persisted to localStorage so each note can have
// its own target. Cross-tab sync via the native `storage` event.
import { useCallback, useEffect, useState } from "react";

const KEY_PREFIX = "note-word-goal:";
const REACHED_PREFIX = "note-word-goal-reached:";

function readGoal(slug: string): number | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + slug);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Returns goal state for `slug` plus a setter. Pass `null` (or 0) to clear.
 * The "reached" flag is stored separately so we only fire the celebration toast
 * once per goal — re-editing below the threshold and back up doesn't re-toast.
 */
export function useWordGoal(slug: string) {
  const [goal, setGoalState] = useState<number | null>(() => readGoal(slug));

  // Re-read when slug changes (split view, navigation between notes).
  useEffect(() => {
    setGoalState(readGoal(slug));
  }, [slug]);

  // Cross-tab sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_PREFIX + slug) setGoalState(readGoal(slug));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [slug]);

  const setGoal = useCallback(
    (next: number | null) => {
      try {
        if (next && next > 0) {
          localStorage.setItem(KEY_PREFIX + slug, String(Math.floor(next)));
        } else {
          localStorage.removeItem(KEY_PREFIX + slug);
          // Reset celebration when clearing so a future goal can re-trigger.
          localStorage.removeItem(REACHED_PREFIX + slug);
        }
        setGoalState(next && next > 0 ? Math.floor(next) : null);
      } catch {
        // ignore quota errors
      }
    },
    [slug],
  );

  return { goal, setGoal };
}

/** Returns true the FIRST time `words >= goal` for this slug. */
export function consumeGoalReached(slug: string, words: number, goal: number | null): boolean {
  if (!goal || words < goal) return false;
  try {
    const key = REACHED_PREFIX + slug;
    if (localStorage.getItem(key) === String(goal)) return false;
    localStorage.setItem(key, String(goal));
    return true;
  } catch {
    return false;
  }
}
