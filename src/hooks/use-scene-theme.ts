// Scene theme = the OPTIONAL animated/3D background on Home. Orthogonal to
// next-themes (which handles light/dark). Stored in localStorage and broadcast
// across tabs via the standard `storage` event (same pattern as note.pinned).
//
// Default = "none" — zero cost, no shader loaded, no extra chunk fetched.
//
// Hover preview: SceneToggle calls `previewScene(id)` while the cursor is
// over a dropdown item. The preview lives in-memory only (NOT localStorage),
// and consumers see it via the returned `scene`. Clicking commits via
// `setScene` which clears the preview and persists. Closing the menu without
// clicking → call `previewScene(null)` to revert.
import { useCallback, useEffect, useState } from "react";

export const SCENE_STORAGE_KEY = "home.scene";
export const SCENE_DEFAULT = "none";

const PREVIEW_EVENT = "scene-theme-preview";
const COMMIT_EVENT = "scene-theme-change";

// Module-level so all hook instances share the same preview state without
// a context provider.
let memPreview: string | null = null;

function read(): string {
  if (typeof window === "undefined") return SCENE_DEFAULT;
  try {
    return localStorage.getItem(SCENE_STORAGE_KEY) || SCENE_DEFAULT;
  } catch {
    return SCENE_DEFAULT;
  }
}

export function useSceneTheme() {
  const [stored, setStored] = useState<string>(read);
  const [preview, setPreviewState] = useState<string | null>(memPreview);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SCENE_STORAGE_KEY) setStored(read());
    };
    const onLocal = () => setStored(read());
    const onPreview = () => setPreviewState(memPreview);
    window.addEventListener("storage", onStorage);
    window.addEventListener(COMMIT_EVENT, onLocal);
    window.addEventListener(PREVIEW_EVENT, onPreview);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(COMMIT_EVENT, onLocal);
      window.removeEventListener(PREVIEW_EVENT, onPreview);
    };
  }, []);

  const setScene = useCallback((next: string) => {
    // Commit clears any active preview.
    memPreview = null;
    try {
      localStorage.setItem(SCENE_STORAGE_KEY, next);
    } catch {
      // QuotaExceeded / private mode — still update in-memory state.
    }
    setStored(next);
    window.dispatchEvent(new Event(COMMIT_EVENT));
    window.dispatchEvent(new Event(PREVIEW_EVENT));
  }, []);

  const previewScene = useCallback((next: string | null) => {
    if (memPreview === next) return;
    memPreview = next;
    setPreviewState(next);
    window.dispatchEvent(new Event(PREVIEW_EVENT));
  }, []);

  return {
    /** Effective scene (preview overrides committed). Consumers should use this. */
    scene: preview ?? stored,
    /** Persisted scene — used by guards that must not clobber the user's choice. */
    committedScene: stored,
    setScene,
    previewScene,
  };
}
