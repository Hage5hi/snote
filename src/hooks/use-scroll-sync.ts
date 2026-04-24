import { useEffect } from "react";

/**
 * Two-way percentage-based scroll sync between the editor scroller and the
 * preview pane. Neither pane has the same total height (markdown preview is
 * usually shorter than the source), so we sync on **scroll ratio** rather than
 * absolute pixels.
 *
 * Uses a shared re-entry flag so programmatic `scrollTop` writes don't bounce
 * back through the other element's listener. The flag is cleared on the next
 * animation frame — rAF is long enough for the browser to dispatch the echo
 * scroll event but short enough that genuine user scrolls aren't swallowed.
 */
export function useScrollSync(
  left: HTMLElement | null,
  right: HTMLElement | null,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || !left || !right) return;

    let syncing = false;
    const mirror = (from: HTMLElement, to: HTMLElement) => () => {
      if (syncing) return;
      const fromMax = from.scrollHeight - from.clientHeight;
      const toMax = to.scrollHeight - to.clientHeight;
      if (fromMax <= 0 || toMax <= 0) return;
      const ratio = from.scrollTop / fromMax;
      syncing = true;
      to.scrollTop = ratio * toMax;
      requestAnimationFrame(() => {
        syncing = false;
      });
    };

    const onLeft = mirror(left, right);
    const onRight = mirror(right, left);
    left.addEventListener("scroll", onLeft, { passive: true });
    right.addEventListener("scroll", onRight, { passive: true });

    // Align on mount — when preview pane first appears, snap it to the
    // editor's current ratio so the two start in sync.
    onLeft();

    return () => {
      left.removeEventListener("scroll", onLeft);
      right.removeEventListener("scroll", onRight);
    };
  }, [left, right, enabled]);
}
