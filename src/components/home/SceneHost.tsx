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

// Dev-only logger so we can verify GPU contexts are actually released in the
// browser console (look for "[SceneHost] released WebGL …"). Stripped in
// production builds by the Vite dead-code path on `import.meta.env.DEV`.
function logRelease(label: string) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info(`[SceneHost] released WebGL context: ${label}`);
  }
}

/** Force-release a WebGL context + free its associated canvas pixels. Safe
 *  to call multiple times. Exported so scene components can share the same
 *  cleanup path (see CyberLinhKhi / NeonVapor / EtherealAurora). */
export function releaseWebGLContext(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null,
  canvas?: HTMLCanvasElement | null,
  label = "scene",
) {
  if (!gl) return;
  try {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* ignore */
  }
  if (canvas) {
    // Shrinking to 0×0 prompts browsers to release the backing image buffer.
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      /* ignore */
    }
  }
  logRelease(label);
}

// Cached WebGL probe — creating a context is expensive, so we do it once per
// page load. Returns false on browsers without WebGL OR when the GPU process
// has crashed and Chrome's blocklist is now refusing new contexts.
let webglAvailable: boolean | null = null;
function hasWebGL(): boolean {
  if (webglAvailable !== null) return webglAvailable;
  if (typeof document === "undefined") return (webglAvailable = false);
  let c: HTMLCanvasElement | null = null;
  let gl: WebGLRenderingContext | null = null;
  try {
    c = document.createElement("canvas");
    // Keep the probe canvas tiny so Chrome reserves minimal GPU memory.
    c.width = 1;
    c.height = 1;
    gl =
      (c.getContext("webgl2") as WebGLRenderingContext | null) ||
      (c.getContext("webgl") as WebGLRenderingContext | null) ||
      (c.getContext("experimental-webgl") as WebGLRenderingContext | null);
    webglAvailable = !!gl;
    return webglAvailable;
  } catch {
    return (webglAvailable = false);
  } finally {
    // Always free the probe — even on the success path — so the cached
    // boolean is the only thing that survives this function.
    releaseWebGLContext(gl, c, "probe");
    c = null;
    gl = null;
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

  // Track mount state so the async scene-component's `onReady` callback can't
  // set state on an unmounted host (e.g. when the user picks "none" while a
  // scene is still compiling).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.info("[SceneHost] unmounted — scene component will release its GL context");
      }
    };
  }, []);

  // Per-scene cancellation token. A new AbortController is minted whenever the
  // user switches scene (or on first mount); the previous one is aborted so
  // any in-flight scene setup — dynamic import resolution, asset fetch, shader
  // compile waiters, fetch() with this signal — is signaled to stop
  // immediately. Combined with `releaseWebGLContext` this guarantees no
  // background work survives F5 / scene switch / unmount.
  const abortRef = useRef<AbortController | null>(null);
  if (abortRef.current === null) abortRef.current = new AbortController();
  // Recreate the controller on scene change. Done in render (not effect) so
  // the freshly-mounted lazy component receives the *new* signal, not the
  // about-to-be-aborted one from the previous scene.
  const prevSceneRef = useRef(scene);
  if (prevSceneRef.current !== scene) {
    try { abortRef.current.abort(); } catch { /* ignore */ }
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info(`[SceneHost] aborted scene "${prevSceneRef.current}" — switching to "${scene}"`);
    }
    abortRef.current = new AbortController();
    prevSceneRef.current = scene;
  }
  // Final abort on host unmount.
  useEffect(() => {
    return () => {
      try { abortRef.current?.abort(); } catch { /* ignore */ }
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.info("[SceneHost] aborted active scene signal on unmount");
      }
    };
  }, []);

  // Lazy component reference — keyed on scene id so switching scenes mounts a
  // fresh component (and gets the right chunk). Skipped entirely when blocked
  // by guards, so the dynamic import never fires.
  const SceneComponent = useMemo(() => {
    if (blocked) return null;
    if (!def || !def.enabled || !def.load) return null;
    return lazy(def.load);
  }, [def, blocked]);

  const handleReady = useCallback(() => {
    if (!mountedRef.current) return;
    if (abortRef.current?.signal.aborted) return;
    setReady(true);
  }, []);

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
        <SceneComponent
          paused={paused}
          isDark={isDark}
          onReady={handleReady}
          signal={abortRef.current.signal}
        />
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
