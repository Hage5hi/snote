// Scene theme = the OPTIONAL animated/3D background on Home. Orthogonal to
// next-themes (which handles light/dark). Stored in localStorage and broadcast
// across tabs via the standard `storage` event (same pattern as note.pinned).
//
// Default = "none" — zero cost, no shader loaded, no extra chunk fetched. The
// scene module is dynamic-imported only when the user picks a scene from the
// ThemeToggle dropdown.
import { useCallback, useEffect, useState } from "react";

export const SCENE_STORAGE_KEY = "home.scene";
export const SCENE_DEFAULT = "none";

function read(): string {
  if (typeof window === "undefined") return SCENE_DEFAULT;
  try {
    return localStorage.getItem(SCENE_STORAGE_KEY) || SCENE_DEFAULT;
  } catch {
    return SCENE_DEFAULT;
  }
}

export function useSceneTheme() {
  const [scene, setSceneState] = useState<string>(read);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SCENE_STORAGE_KEY) setSceneState(read());
    };
    window.addEventListener("storage", onStorage);
    // Same-tab updates (storage event only fires cross-tab).
    const onLocal = () => setSceneState(read());
    window.addEventListener("scene-theme-change", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("scene-theme-change", onLocal);
    };
  }, []);

  const setScene = useCallback((next: string) => {
    try {
      localStorage.setItem(SCENE_STORAGE_KEY, next);
    } catch {
      // QuotaExceeded / private mode — still update in-memory state.
    }
    setSceneState(next);
    window.dispatchEvent(new Event("scene-theme-change"));
  }, []);

  return { scene, setScene };
}
