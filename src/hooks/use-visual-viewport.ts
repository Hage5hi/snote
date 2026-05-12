// Tracks the visual viewport on mobile and exposes the on-screen-keyboard
// height as a CSS variable (`--kb-inset`). Components using `.lift-bottom`
// or `padding-bottom: var(--kb-inset)` automatically clear the keyboard.
//
// Rationale: iOS Safari doesn't reflow the layout when the soft keyboard
// opens — the layout viewport stays full-height and the visual viewport
// shrinks. The delta is the keyboard height.
//
// No-op on desktop (no `window.visualViewport`) so it's safe to mount once
// at app root.
import { useEffect } from "react";

export function useVisualViewport(): void {
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const root = document.documentElement;
    let rafId = 0;

    const update = () => {
      // Coalesce rapid resize/scroll events into one frame.
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        // Keyboard inset = how much the visual viewport is shorter than the
        // layout viewport, minus any scroll offset of the visual viewport
        // itself (which happens when the URL bar collapses).
        const kb = Math.max(
          0,
          window.innerHeight - vv.height - vv.offsetTop,
        );
        root.style.setProperty("--kb-inset", `${Math.round(kb)}px`);
      });
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(rafId);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.setProperty("--kb-inset", "0px");
    };
  }, []);
}
