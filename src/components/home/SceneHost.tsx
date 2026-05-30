// SceneHost — mounts the optional animated background on Home.
//
// Zero cost when scene === "none" (returns null before any dynamic import).
// Runs runtime guards (reduced-motion, e-ink, low-end, save-data) and reverts
// the user's choice when guards trip, then suppresses re-prompting via a
// session flag.
//
// Fade-in policy: the host renders at opacity-0 until the scene reports its
// first compiled frame, then transitions to its final opacity. This avoids
// the flicker/layout-shift that a skeleton fallback would cause on a -z-10
// background layer.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { SCENE_NONE, getSceneDef, type SceneDef } from "./scenes/registry";
import { useSceneTheme } from "@/hooks/use-scene-theme";

const GUARD_FLAG_KEY = "home.scene.guard-reverted";

// Cached WebGL probe — creating a context is expensive, so we do it once per
// page load. Returns false on browsers without WebGL OR when the GPU process
// has crashed and Chrome's blocklist is now refusing new contexts.
let webglAvailable: boolean | null = null;
function hasWebGL(): boolean {
  if (webglAvailable !== null) return webglAvailable;
  if (typeof document === "undefined") return (webglAvailable = false);
  try {
    const c = document.createElement("canvas");
    const gl =
      (c.getContext("webgl2") as WebGLRenderingContext | null) ||
      (c.getContext("webgl") as WebGLRenderingContext | null) ||
      (c.getContext("experimental-webgl") as WebGLRenderingContext | null);
    webglAvailable = !!gl;
    // Free the probe context immediately.
    if (gl) gl.getExtension("WEBGL_lose_context")?.loseContext();
    return webglAvailable;
  } catch {
    return (webglAvailable = false);
  }
}

function shouldBlockScene(def: SceneDef | undefined): boolean {
  if (typeof window === "undefined") return true;
  if (document.documentElement.classList.contains("eink")) return true;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  } catch {
    /* matchMedia not available */
  }
  // Lightweight Canvas2D scenes (e.g. Obsidian Ink) opt out of the
  // hardwareConcurrency gate — they render fine on 2-core devices.
  if (!def?.lightweight && (navigator.hardwareConcurrency ?? 8) < 4) return true;
  // WebGL-required scenes (anything not flagged `lightweight`) need a usable
  // GL context. If the probe fails, revert to "none" so the user sees the
  // default chrome instead of a black div + a console error from OGL.
  if (!def?.lightweight && !hasWebGL()) return true;
  const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData) return true;
  if (conn?.effectiveType === "2g" || conn?.effectiveType === "slow-2g") return true;
  return false;
}

export default function SceneHost() {
  const { scene, committedScene, setScene } = useSceneTheme();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [paused, setPaused] = useState(
    typeof document !== "undefined" && document.visibilityState !== "visible",
  );
  const [ready, setReady] = useState(false);
  const revertedRef = useRef(false);

  const def = getSceneDef(scene);

  // Run the guard synchronously on the first render where a scene is selected.
  // This avoids creating the React.lazy ref (and thus dispatching the dynamic
  // import) before we've decided whether to render the scene at all — which
  // is the contract the perf tests enforce.
  const blocked = scene !== SCENE_NONE && shouldBlockScene(def);

  // Revert the user's *committed* choice once (post-commit) so the dropdown
  // reflects it. NEVER fire when the user is merely previewing on hover —
  // that would wipe their saved scene back to "none" just because their
  // current hover target happens to be guard-blocked.
  useEffect(() => {
    if (!blocked) return;
    if (committedScene === SCENE_NONE) return;
    if (revertedRef.current) return;
    revertedRef.current = true;
    try {
      sessionStorage.setItem(GUARD_FLAG_KEY, "1");
    } catch {
      /* ignore */
    }
    setScene(SCENE_NONE);
  }, [blocked, committedScene, setScene]);

  // Reset ready state whenever we switch scenes.
  useEffect(() => {
    setReady(false);
  }, [scene]);

  // Pause render loop while the tab is hidden.
  useEffect(() => {
    const onVis = () => setPaused(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Lazy component reference — keyed on scene id so switching scenes mounts a
  // fresh component (and gets the right chunk). Skipped entirely when blocked
  // by guards, so the dynamic import never fires.
  const SceneComponent = useMemo(() => {
    if (blocked) return null;
    if (!def || !def.enabled || !def.load) return null;
    return lazy(def.load);
  }, [def, blocked]);

  const handleReady = useCallback(() => setReady(true), []);

  if (blocked || !def || def.id === SCENE_NONE || !SceneComponent) return null;

  return (
    <div
      aria-hidden="true"
      className={[
        "pointer-events-none fixed inset-0 z-0 overflow-hidden",
        "motion-safe:transition-opacity motion-safe:duration-700 motion-safe:ease-out",
        ready ? "opacity-100" : "opacity-0",
      ].join(" ")}
      data-scene-ready={ready ? "true" : "false"}
    >
      <Suspense fallback={null}>
        <SceneComponent paused={paused} isDark={isDark} onReady={handleReady} />
      </Suspense>
      {/* Edge masks — pulled from per-scene tokens defined on
          [data-app-root][data-scene=...]. Keeps Header + Recents legible
          without painting a hard letterbox bar. */}
      <div
        className="absolute inset-x-0 top-0 h-24"
        style={{ background: "var(--home-mask-top)" }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-32"
        style={{ background: "var(--home-mask-bottom)" }}
      />
    </div>
  );
}
