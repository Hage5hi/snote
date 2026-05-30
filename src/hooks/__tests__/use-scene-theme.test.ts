// Unit tests for useSceneTheme — covering the hover-preview contract:
//
//   - `scene` is the effective value (preview overrides committed).
//   - `committedScene` is the persisted value (what guards must check).
//   - `previewScene(id)` never writes localStorage.
//   - `previewScene(null)` reverts to committed.
//   - `setScene(x)` commits AND clears any active preview.
//   - The module-level preview state is shared across hook instances in the
//     same tab (no Context provider needed).
//   - The `storage` event from another tab updates committedScene.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useSceneTheme,
  SCENE_STORAGE_KEY,
  SCENE_DEFAULT,
} from "@/hooks/use-scene-theme";

function resetModuleState() {
  // The hook holds module-level preview state. Easiest reliable reset between
  // tests is to dispatch a null preview through the public API; we do that in
  // each test's setup by calling previewScene(null) via a throwaway hook.
  const { result, unmount } = renderHook(() => useSceneTheme());
  act(() => result.current.previewScene(null));
  unmount();
}

describe("useSceneTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    resetModuleState();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to 'none' when localStorage is empty", () => {
    const { result } = renderHook(() => useSceneTheme());
    expect(result.current.scene).toBe(SCENE_DEFAULT);
    expect(result.current.committedScene).toBe(SCENE_DEFAULT);
  });

  it("setScene writes localStorage and updates both scene and committedScene", () => {
    const { result } = renderHook(() => useSceneTheme());
    act(() => result.current.setScene("cyber-linh-khi"));
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBe("cyber-linh-khi");
    expect(result.current.scene).toBe("cyber-linh-khi");
    expect(result.current.committedScene).toBe("cyber-linh-khi");
  });

  it("previewScene updates `scene` but NOT `committedScene` and does NOT write localStorage", () => {
    const { result } = renderHook(() => useSceneTheme());
    act(() => result.current.setScene("cyber-linh-khi"));
    act(() => result.current.previewScene("ethereal-aurora"));

    expect(result.current.scene).toBe("ethereal-aurora");
    expect(result.current.committedScene).toBe("cyber-linh-khi");
    // localStorage still holds the committed value, NOT the preview.
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBe("cyber-linh-khi");
  });

  it("previewScene(null) reverts effective scene back to committed", () => {
    const { result } = renderHook(() => useSceneTheme());
    act(() => result.current.setScene("cyber-linh-khi"));
    act(() => result.current.previewScene("ethereal-aurora"));
    expect(result.current.scene).toBe("ethereal-aurora");

    act(() => result.current.previewScene(null));
    expect(result.current.scene).toBe("cyber-linh-khi");
    expect(result.current.committedScene).toBe("cyber-linh-khi");
  });

  it("setScene during an active preview clears the preview and commits", () => {
    const { result } = renderHook(() => useSceneTheme());
    act(() => result.current.setScene("cyber-linh-khi"));
    act(() => result.current.previewScene("neon-vapor"));
    expect(result.current.scene).toBe("neon-vapor");

    act(() => result.current.setScene("obsidian-ink"));
    expect(result.current.scene).toBe("obsidian-ink");
    expect(result.current.committedScene).toBe("obsidian-ink");
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBe("obsidian-ink");
  });

  it("preview state is shared across hook instances in the same tab", () => {
    const a = renderHook(() => useSceneTheme());
    const b = renderHook(() => useSceneTheme());
    act(() => a.result.current.setScene("cyber-linh-khi"));
    act(() => a.result.current.previewScene("terminal-boot"));

    expect(a.result.current.scene).toBe("terminal-boot");
    expect(b.result.current.scene).toBe("terminal-boot");
    expect(b.result.current.committedScene).toBe("cyber-linh-khi");
  });

  it("cross-tab storage event updates committedScene", () => {
    const { result } = renderHook(() => useSceneTheme());
    act(() => {
      localStorage.setItem(SCENE_STORAGE_KEY, "neon-vapor");
      window.dispatchEvent(
        new StorageEvent("storage", { key: SCENE_STORAGE_KEY, newValue: "neon-vapor" }),
      );
    });
    expect(result.current.committedScene).toBe("neon-vapor");
    expect(result.current.scene).toBe("neon-vapor");
  });

  it("previewing the same id twice is a no-op (idempotent)", () => {
    const { result } = renderHook(() => useSceneTheme());
    act(() => result.current.previewScene("cyber-linh-khi"));
    const after1 = result.current.scene;
    act(() => result.current.previewScene("cyber-linh-khi"));
    expect(result.current.scene).toBe(after1);
  });
});
