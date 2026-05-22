// Scene Registry — pluggable list of background scenes for the Home route.
//
// To add a new scene later:
//   1. Create src/components/home/scenes/MyScene.tsx with default export of a
//      React component that takes `SceneProps`.
//   2. Add a Vite manualChunks rule routing that file to `scene-my-scene`.
//   3. Flip the registry entry's `enabled` to true and set `load`.
//
// That's it — ThemeToggle, SceneHost, and Home.tsx never need to change.
import type { ComponentType } from "react";

export interface SceneProps {
  /** True when document.visibilityState !== "visible". Scene should pause rAF. */
  paused: boolean;
  /** Active color scheme so the shader can theme itself. */
  isDark: boolean;
  /** Called once the shader has compiled + rendered its first frame.
   *  SceneHost uses this to fade the background in (avoids flicker). */
  onReady?: () => void;
}

export interface SceneDef {
  id: string;
  /** i18n key in dict. Falls back to `id` if key missing. */
  labelKey: string;
  /** 2-stop preview swatch for the dropdown menu. */
  swatch: [string, string];
  /** Short description shown under the label. */
  descKey?: string;
  /** false → render as disabled "Coming soon" row. */
  enabled: boolean;
  /** Only present when enabled. Dynamic import the scene module. */
  load?: () => Promise<{ default: ComponentType<SceneProps> }>;
  /** When set, ThemeToggle pins next-themes to this scheme on selection so
   *  the UI tokens (header/recents/borders) match the scene's mood. */
  forceColorScheme?: "light" | "dark";
  /** Bypass the hardwareConcurrency<4 guard. Use for cheap Canvas2D scenes
   *  that run fine on low-end devices. WebGL shaders should leave this off. */
  lightweight?: boolean;
  /** Per-scene maxDiffPixelRatio for the masked scene layer / hit-test
   *  specs. Tailored per scene because shader-heavy backgrounds tolerate
   *  slightly more GPU/AA jitter even when masked, while flat Canvas2D
   *  scenes can use a tighter gate. Env PIXEL_DIFF_RATIO still overrides. */
  pixelDiffRatio?: number;
  /** Per-scene maxDiffPixelRatio override for the *chrome* screenshot
   *  (Header + slug input + Recents). Separate axis from pixelDiffRatio so
   *  a glow-heavy scene whose halos bleed into chrome edges can relax
   *  chrome tolerance without loosening the masked-layer gate. Falls back
   *  to pixelDiffRatio when unset. Env CHROME_DIFF_RATIO still overrides. */
  chromeDiffRatio?: number;
}

export const SCENE_NONE = "none";

export const SCENE_REGISTRY: SceneDef[] = [
  {
    id: SCENE_NONE,
    labelKey: "scene.none.label",
    descKey: "scene.none.desc",
    swatch: ["hsl(var(--background))", "hsl(var(--muted))"],
    enabled: true,
  },
  {
    id: "cyber-linh-khi",
    labelKey: "scene.cyber_linh_khi.label",
    descKey: "scene.cyber_linh_khi.desc",
    swatch: ["#0a2a26", "#5eead4"],
    enabled: true,
    load: () => import("./CyberLinhKhi"),
    forceColorScheme: "dark",
    // Heavy shader with glow halos that bleed slightly past the mask edges.
    pixelDiffRatio: 0.035,
  },
  {
    id: "ethereal-aurora",
    labelKey: "scene.ethereal_aurora.label",
    descKey: "scene.ethereal_aurora.desc",
    swatch: ["#2d1b4e", "#fbcfe8"],
    enabled: true,
    load: () => import("./EtherealAurora"),
    forceColorScheme: "dark",
    // Curl-noise ribbons; soft pastels diffuse into chrome edges.
    pixelDiffRatio: 0.04,
  },
  {
    id: "obsidian-ink",
    labelKey: "scene.obsidian_ink.label",
    descKey: "scene.obsidian_ink.desc",
    swatch: ["#f5f5f4", "#1c1917"],
    enabled: true,
    load: () => import("./ObsidianInk"),
    forceColorScheme: "light",
    lightweight: true,
    // Flat paper; tighten the gate to catch the smallest token regression.
    pixelDiffRatio: 0.015,
  },
  {
    id: "digital-constellation",
    labelKey: "scene.digital_constellation.label",
    descKey: "scene.digital_constellation.desc",
    swatch: ["#1e293b", "#cbd5e1"],
    enabled: true,
    load: () => import("./DigitalConstellation"),
    forceColorScheme: "dark",
    lightweight: true,
    pixelDiffRatio: 0.02,
  },
  {
    id: "neon-vapor",
    labelKey: "scene.neon_vapor.label",
    descKey: "scene.neon_vapor.desc",
    swatch: ["#1a0a2e", "#ec4899"],
    enabled: true,
    load: () => import("./NeonVapor"),
    forceColorScheme: "dark",
    // Scanlines + magenta fog; highest tolerable jitter.
    pixelDiffRatio: 0.045,
  },
  {
    id: "terminal-boot",
    labelKey: "scene.terminal_boot.label",
    descKey: "scene.terminal_boot.desc",
    swatch: ["#020202", "#00ff66"],
    enabled: true,
    load: () => import("./TerminalBoot"),
    forceColorScheme: "dark",
    lightweight: true,
    pixelDiffRatio: 0.02,
  },
];

export function getSceneDef(id: string): SceneDef | undefined {
  return SCENE_REGISTRY.find((s) => s.id === id);
}
