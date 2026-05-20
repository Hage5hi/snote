/**
 * SceneHost smoke test.
 *
 * Locks in the core perf contract of the Scene Registry:
 *   1. When `scene === "none"` (default), the heavy scene chunks
 *      (`scene-cyber-linh-khi`, `ogl-vendor`) MUST NOT be fetched —
 *      i.e. the registry's `load()` factory MUST NOT be invoked.
 *   2. When a user opts in to a scene, the matching `load()` is called
 *      exactly once.
 *
 * We can't observe Vite's chunk graph from jsdom, but `load()` is the
 * single entry point through which any scene module enters the bundle
 * at runtime — guarding it is equivalent to guarding the chunk fetch.
 */
import { render, act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next-themes — SceneHost only reads `resolvedTheme`.
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

// Spy factories + a controllable ready-scene factory.
const { cyberLoad, etherealLoad, readySceneLoad, fireReady } = vi.hoisted(() => {
  let onReadyRef: (() => void) | undefined;
  return {
    cyberLoad: vi.fn(async () => ({
      default: () => null,
    })),
    etherealLoad: vi.fn(async () => ({
      default: () => null,
    })),
    // Scene that captures onReady and exposes a trigger.
    readySceneLoad: vi.fn(async () => ({
      default: (props: { onReady?: () => void }) => {
        onReadyRef = props.onReady;
        return null;
      },
    })),
    fireReady: () => onReadyRef?.(),
  };
});

vi.mock("@/components/home/scenes/registry", () => ({
  SCENE_NONE: "none",
  SCENE_REGISTRY: [
    { id: "none", labelKey: "scene.none.label", swatch: ["#000", "#fff"], enabled: true },
    {
      id: "cyber-linh-khi",
      labelKey: "scene.cyber_linh_khi.label",
      swatch: ["#0a2a26", "#5eead4"],
      enabled: true,
      load: cyberLoad,
    },
    {
      id: "ethereal-aurora",
      labelKey: "scene.ethereal_aurora.label",
      swatch: ["#2d1b4e", "#fbcfe8"],
      enabled: true,
      load: etherealLoad,
    },
    {
      id: "ready-scene",
      labelKey: "scene.cyber_linh_khi.label",
      swatch: ["#000", "#fff"],
      enabled: true,
      load: readySceneLoad,
    },
  ],
  getSceneDef: (id: string) => {
    const map: Record<string, unknown> = {
      none: { id: "none", enabled: true },
      "cyber-linh-khi": { id: "cyber-linh-khi", enabled: true, load: cyberLoad },
      "ethereal-aurora": { id: "ethereal-aurora", enabled: true, load: etherealLoad },
      "ready-scene": { id: "ready-scene", enabled: true, load: readySceneLoad },
    };
    return map[id];
  },
}));

import SceneHost from "@/components/home/SceneHost";
import { SCENE_STORAGE_KEY } from "@/hooks/use-scene-theme";

/** Set up matchMedia mock with a fixed reduced-motion answer. */
function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? matches : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("SceneHost — chunk-loading contract", () => {
  beforeEach(() => {
    cyberLoad.mockClear();
    etherealLoad.mockClear();
    readySceneLoad.mockClear();
    localStorage.clear();
    sessionStorage.clear();
    mockReducedMotion(false);
  });

  afterEach(() => {
    cleanup();
  });

  it("does NOT load any scene chunk when scene = 'none' (default)", () => {
    const { container } = render(<SceneHost />);
    expect(container.firstChild).toBeNull();
    expect(cyberLoad).not.toHaveBeenCalled();
    expect(etherealLoad).not.toHaveBeenCalled();
  });

  it("does NOT load any scene chunk when storage holds 'none' explicitly", () => {
    localStorage.setItem(SCENE_STORAGE_KEY, "none");
    render(<SceneHost />);
    expect(cyberLoad).not.toHaveBeenCalled();
    expect(etherealLoad).not.toHaveBeenCalled();
  });

  it("loads ONLY the matching scene chunk when the user opts in", async () => {
    localStorage.setItem(SCENE_STORAGE_KEY, "cyber-linh-khi");
    await act(async () => {
      render(<SceneHost />);
    });
    expect(cyberLoad).toHaveBeenCalledTimes(1);
    expect(etherealLoad).not.toHaveBeenCalled();
  });

  it("starts hidden (opacity-0) before the scene reports it is ready", () => {
    localStorage.setItem(SCENE_STORAGE_KEY, "cyber-linh-khi");
    const { container } = render(<SceneHost />);
    const host = container.querySelector("[data-scene-ready]");
    expect(host).not.toBeNull();
    expect(host?.getAttribute("data-scene-ready")).toBe("false");
    expect(host?.className).toMatch(/opacity-0/);
  });

  it("transitions to opacity-100 only after scene fires onReady", async () => {
    localStorage.setItem(SCENE_STORAGE_KEY, "ready-scene");
    const { container } = await act(async () => render(<SceneHost />));

    const initial = container.querySelector("[data-scene-ready]");
    expect(initial?.getAttribute("data-scene-ready")).toBe("false");
    expect(initial?.className).toMatch(/opacity-0/);
    expect(initial?.className).not.toMatch(/opacity-100/);

    await act(async () => {
      fireReady();
    });

    await waitFor(() => {
      const host = container.querySelector("[data-scene-ready]");
      expect(host?.getAttribute("data-scene-ready")).toBe("true");
      expect(host?.className).toMatch(/opacity-100/);
    });
  });

  it("reverts to 'none' and renders nothing when prefers-reduced-motion: reduce", async () => {
    mockReducedMotion(true);
    localStorage.setItem(SCENE_STORAGE_KEY, "cyber-linh-khi");
    const { container } = await act(async () => render(<SceneHost />));
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
      expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBe("none");
    });
    // Strict perf contract: the heavy scene chunk MUST NOT be requested when
    // the user has prefers-reduced-motion: reduce.
    expect(cyberLoad).not.toHaveBeenCalled();
  });

  it("host is fixed/pointer-events-none so masks can never block UI", async () => {
    localStorage.setItem(SCENE_STORAGE_KEY, "cyber-linh-khi");
    const { container } = await act(async () => render(<SceneHost />));
    const host = container.querySelector("[data-scene-ready]") as HTMLElement;
    expect(host.className).toMatch(/pointer-events-none/);
    expect(host.className).toMatch(/fixed/);
    expect(host.className).toMatch(/-z-10/);
    // Top mask is 96px (h-24), bottom mask is 128px (h-32) — both short enough
    // that the centered Hero (~ vh/2) and recents block stay legible.
    const masks = host.querySelectorAll("div.absolute");
    expect(masks.length).toBe(2);
    expect(masks[0].className).toMatch(/h-24/);
    expect(masks[1].className).toMatch(/h-32/);
  });
});

