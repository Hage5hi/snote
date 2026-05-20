// SceneHost — mounts the optional animated background on Home.
//
// Zero cost when scene === "none" (returns null before any dynamic import).
// Runs runtime guards (reduced-motion, e-ink, low-end, save-data) and reverts
// the user's choice when guards trip, then suppresses re-prompting via a
// session flag.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  const revertedRef = useRef(false);

  // Guard once per mount — if blocked, revert to none and remember.
  useEffect(() => {
    if (scene === SCENE_NONE) return;
    if (revertedRef.current) return;
    if (shouldBlockScene()) {
      revertedRef.current = true;
      try {
        sessionStorage.setItem(GUARD_FLAG_KEY, "1");
      } catch {
        /* ignore */
      }
      setScene(SCENE_NONE);
    }
  }, [scene, setScene]);

  // Pause render loop while the tab is hidden.
  useEffect(() => {
    const onVis = () => setPaused(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const def = getSceneDef(scene);

  // Lazy component reference — keyed on scene id so switching scenes mounts a
  // fresh component (and gets the right chunk).
  const SceneComponent = useMemo(() => {
    if (!def || !def.enabled || !def.load) return null;
    return lazy(def.load);
  }, [def]);

  if (!def || def.id === SCENE_NONE || !SceneComponent) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <Suspense fallback={null}>
        <SceneComponent paused={paused} isDark={isDark} />
      </Suspense>
      {/* Soft mask: keeps top/bottom edges grounded with the page bg so the
          header chrome + bottom recents stay legible. */}
      <div
        className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/10 to-background/80"
      />
    </div>
  );
}
