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
import { SCENE_NONE, getSceneDef } from "./scenes/registry";
import { useSceneTheme } from "@/hooks/use-scene-theme";

const GUARD_FLAG_KEY = "home.scene.guard-reverted";

function shouldBlockScene(): boolean {
  if (typeof window === "undefined") return true;
  if (document.documentElement.classList.contains("eink")) return true;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  } catch {
    /* matchMedia not available */
  }
  if ((navigator.hardwareConcurrency ?? 8) < 4) return true;
  const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData) return true;
  if (conn?.effectiveType === "2g" || conn?.effectiveType === "slow-2g") return true;
  return false;
}

export default function SceneHost() {
  const { scene, setScene } = useSceneTheme();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [paused, setPaused] = useState(
    typeof document !== "undefined" && document.visibilityState !== "visible",
  );
  const [ready, setReady] = useState(false);
  const revertedRef = useRef(false);

  // Run the guard synchronously on the first render where a scene is selected.
  // This avoids creating the React.lazy ref (and thus dispatching the dynamic
  // import) before we've decided whether to render the scene at all — which
  // is the contract the perf tests enforce.
  const blocked = scene !== SCENE_NONE && shouldBlockScene();

  // Revert the user's choice once (post-commit) so the dropdown reflects it.
  useEffect(() => {
    if (!blocked) return;
    if (revertedRef.current) return;
    revertedRef.current = true;
    try {
      sessionStorage.setItem(GUARD_FLAG_KEY, "1");
    } catch {
      /* ignore */
    }
    setScene(SCENE_NONE);
  }, [blocked, setScene]);

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

  const def = getSceneDef(scene);

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
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden",
        "transition-opacity duration-700 ease-out",
        ready ? "opacity-100" : "opacity-0",
      ].join(" ")}
      data-scene-ready={ready ? "true" : "false"}
    >
      <Suspense fallback={null}>
        <SceneComponent paused={paused} isDark={isDark} onReady={handleReady} />
      </Suspense>
      {/* Very light edge mask — keeps top header bar + bottom recents legible
          without washing out the shader on light backgrounds. */}
      <div
        className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background/80 to-transparent"
      />
      <div
        className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background/70 to-transparent"
      />
    </div>
  );
}
