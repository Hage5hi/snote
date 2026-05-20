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
import { render, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next-themes — SceneHost only reads `resolvedTheme`.
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

// Spy factories — must be declared via `vi.hoisted` so the mock factory
// below can reference them (vi.mock is hoisted above top-level code).
const { cyberLoad, etherealLoad } = vi.hoisted(() => ({
  cyberLoad: vi.fn(async () => ({
    default: () => null,
  })),
  etherealLoad: vi.fn(async () => ({
    default: () => null,
  })),
}));

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
  ],
  getSceneDef: (id: string) => {
    const map: Record<string, unknown> = {
      none: { id: "none", enabled: true },
      "cyber-linh-khi": {
        id: "cyber-linh-khi",
        enabled: true,
        load: cyberLoad,
      },
      "ethereal-aurora": {
        id: "ethereal-aurora",
        enabled: true,
        load: etherealLoad,
      },
    };
    return map[id];
  },
}));

import SceneHost from "@/components/home/SceneHost";
import { SCENE_STORAGE_KEY } from "@/hooks/use-scene-theme";

describe("SceneHost — chunk-loading contract", () => {
  beforeEach(() => {
    cyberLoad.mockClear();
    etherealLoad.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("does NOT load any scene chunk when scene = 'none' (default)", () => {
    const { container } = render(<SceneHost />);

    // Renders nothing — no host div, no Suspense boundary.
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
});
