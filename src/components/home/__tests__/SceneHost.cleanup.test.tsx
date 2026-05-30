/**
 * SceneHost cleanup contract.
 *
 * Locks in the post-unmount safety guarantees:
 *   1. The AbortSignal handed to the scene aborts on host unmount.
 *   2. The AbortSignal aborts when the user switches to a different scene
 *      (so the *previous* scene's async work stops, not the new one's).
 *   3. `onReady` fired AFTER the host unmounts does not flip `data-scene-ready`
 *      back to true (no setState on unmounted host).
 *   4. The hasWebGL() probe creates exactly one tiny canvas, immediately
 *      calls loseContext, and shrinks the canvas to 0×0 — i.e. the probe
 *      context is released before SceneHost ever paints.
 */
import { render, act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

// Capturing scene factory: stashes the props it was rendered with so each
// test can poke at `signal` and call `onReady` from outside React.
const { sceneLoad, capturedProps, switchSceneLoad } = vi.hoisted(() => {
  const captured: { signal?: AbortSignal; onReady?: () => void }[] = [];
  return {
    capturedProps: captured,
    sceneLoad: vi.fn(async () => ({
      default: (props: { signal?: AbortSignal; onReady?: () => void }) => {
        captured.push({ signal: props.signal, onReady: props.onReady });
        return null;
      },
    })),
    switchSceneLoad: vi.fn(async () => ({
      default: (props: { signal?: AbortSignal; onReady?: () => void }) => {
        captured.push({ signal: props.signal, onReady: props.onReady });
        return null;
      },
    })),
  };
});

vi.mock("@/components/home/scenes/registry", () => ({
  SCENE_NONE: "none",
  SCENE_REGISTRY: [
    { id: "none", labelKey: "scene.none.label", swatch: ["#000", "#fff"], enabled: true },
    { id: "scene-a", labelKey: "a", swatch: ["#000", "#fff"], enabled: true, load: sceneLoad },
    { id: "scene-b", labelKey: "b", swatch: ["#000", "#fff"], enabled: true, load: switchSceneLoad },
  ],
  getSceneDef: (id: string) => {
    const map: Record<string, unknown> = {
      none: { id: "none", enabled: true },
      "scene-a": { id: "scene-a", enabled: true, load: sceneLoad },
      "scene-b": { id: "scene-b", enabled: true, load: switchSceneLoad },
    };
    return map[id];
  },
}));

import SceneHost from "@/components/home/SceneHost";
import { SCENE_STORAGE_KEY } from "@/hooks/use-scene-theme";

beforeEach(() => {
  sceneLoad.mockClear();
  switchSceneLoad.mockClear();
  capturedProps.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
});

describe("SceneHost — cleanup & cancellation contract", () => {
  // NOTE: probe test MUST run first — `hasWebGL()` caches its result in a
  // module-level variable, so subsequent mounts in this file will skip the
  // createElement("canvas") path entirely.
  it("hasWebGL probe: releases its WebGL context (loseContext + canvas 0x0)", async () => {
    const loseContext = vi.fn();
    const fakeGl = {
      getExtension: vi.fn((name: string) =>
        name === "WEBGL_lose_context" ? { loseContext } : null,
      ),
    };

    let probeCanvas: HTMLCanvasElement | null = null;
    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string, opts?: ElementCreationOptions) => {
        const el = realCreateElement(tagName as keyof HTMLElementTagNameMap, opts);
        if (tagName === "canvas" && !probeCanvas) {
          probeCanvas = el as HTMLCanvasElement;
          (el as HTMLCanvasElement).getContext = vi.fn(() => fakeGl) as unknown as HTMLCanvasElement["getContext"];
        }
        return el;
      }) as typeof document.createElement,
    );

    localStorage.setItem(SCENE_STORAGE_KEY, "scene-a");
    await act(async () => { render(<SceneHost />); });

    expect(probeCanvas).not.toBeNull();
    expect(loseContext).toHaveBeenCalledTimes(1);
    // Canvas shrunk to 0×0 so the browser releases its backing buffer.
    expect(probeCanvas!.width).toBe(0);
    expect(probeCanvas!.height).toBe(0);

    createSpy.mockRestore();
  });

  it("hands the scene a non-aborted AbortSignal on mount", async () => {
    localStorage.setItem(SCENE_STORAGE_KEY, "scene-a");
    await act(async () => { render(<SceneHost />); });
    await waitFor(() => expect(capturedProps.length).toBeGreaterThan(0));
    expect(capturedProps[0].signal).toBeInstanceOf(AbortSignal);
    expect(capturedProps[0].signal?.aborted).toBe(false);
  });

  it("aborts the scene's signal when SceneHost unmounts", async () => {
    localStorage.setItem(SCENE_STORAGE_KEY, "scene-a");
    const { unmount } = await act(async () => render(<SceneHost />));
    await waitFor(() => expect(capturedProps.length).toBeGreaterThan(0));
    const sig = capturedProps[0].signal!;
    expect(sig.aborted).toBe(false);

    let aborted = false;
    sig.addEventListener("abort", () => { aborted = true; });

    await act(async () => { unmount(); });

    expect(aborted).toBe(true);
    expect(sig.aborted).toBe(true);
  });

  it("does not flip data-scene-ready to true when onReady fires AFTER unmount", async () => {
    localStorage.setItem(SCENE_STORAGE_KEY, "scene-a");
    const { container, unmount } = await act(async () => render(<SceneHost />));
    await waitFor(() => expect(capturedProps.length).toBeGreaterThan(0));
    const onReady = capturedProps[0].onReady!;

    // Snapshot host BEFORE unmount.
    const before = container.querySelector("[data-scene-ready]");
    expect(before?.getAttribute("data-scene-ready")).toBe("false");

    // Unmount, then simulate the scene's deferred onReady racing the teardown.
    await act(async () => { unmount(); });

    // Calling the stale onReady must NOT throw or warn about setState on
    // unmounted component. handleReady short-circuits on !mounted && aborted.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => onReady()).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    // Host is gone — there's nothing to flip.
    expect(container.querySelector("[data-scene-ready]")).toBeNull();
  });

  it("aborts the previous scene's signal when the user switches to a new scene", async () => {
    localStorage.setItem(SCENE_STORAGE_KEY, "scene-a");
    const { rerender } = await act(async () => render(<SceneHost />));
    await waitFor(() => expect(capturedProps.length).toBeGreaterThan(0));
    const firstSignal = capturedProps[0].signal!;
    expect(firstSignal.aborted).toBe(false);

    // Simulate the user picking a different scene.
    localStorage.setItem(SCENE_STORAGE_KEY, "scene-b");
    window.dispatchEvent(new StorageEvent("storage", {
      key: SCENE_STORAGE_KEY,
      newValue: "scene-b",
    }));
    await act(async () => { rerender(<SceneHost />); });

    await waitFor(() => {
      // First scene's signal is aborted.
      expect(firstSignal.aborted).toBe(true);
      // The new scene received a *fresh* signal that is NOT aborted.
      const last = capturedProps[capturedProps.length - 1];
      expect(last.signal).toBeInstanceOf(AbortSignal);
      expect(last.signal).not.toBe(firstSignal);
      expect(last.signal?.aborted).toBe(false);
    });
  });

  it("hasWebGL probe: creates a 1x1 canvas, calls loseContext, shrinks to 0x0", async () => {
    // Inject a spy WebGL context onto the next canvas getContext call.
    const loseContext = vi.fn();
    const fakeGl = {
      getExtension: vi.fn((name: string) =>
        name === "WEBGL_lose_context" ? { loseContext } : null,
      ),
    };

    let probeCanvas: HTMLCanvasElement | null = null;
    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string, opts?: ElementCreationOptions) => {
        const el = realCreateElement(tagName as keyof HTMLElementTagNameMap, opts);
        if (tagName === "canvas" && !probeCanvas) {
          probeCanvas = el as HTMLCanvasElement;
          // First getContext call (any variant) returns our spy.
          (el as HTMLCanvasElement).getContext = vi.fn(() => fakeGl) as unknown as HTMLCanvasElement["getContext"];
        }
        return el;
      }) as typeof document.createElement,
    );

    // Trigger the probe by mounting with a scene that requires WebGL.
    localStorage.setItem(SCENE_STORAGE_KEY, "scene-a");
    await act(async () => { render(<SceneHost />); });

    expect(probeCanvas).not.toBeNull();
    // Probe was created at 1×1 …
    // (we can't observe the intermediate 1×1 after shrink, but we can
    // observe it ended at 0×0 — the contract is "minimal allocation now,
    // zero allocation after release")
    expect(probeCanvas!.width).toBe(0);
    expect(probeCanvas!.height).toBe(0);
    expect(loseContext).toHaveBeenCalledTimes(1);

    createSpy.mockRestore();
  });
});
