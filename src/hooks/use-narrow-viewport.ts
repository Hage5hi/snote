import * as React from "react";

// Layout-mode breakpoint for the note editor. Wider than the global mobile
// breakpoint (768px) because splitting editor + preview side-by-side still
// feels cramped at 800px on a desktop window — at this width we collapse to a
// "one pane at a time" mode where the preview toggle swaps between editor and
// rendered preview instead of stacking them.
const NARROW_BREAKPOINT = 900;

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${NARROW_BREAKPOINT - 1}px)`).matches;
  });

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT - 1}px)`);
    const onChange = () => setNarrow(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return narrow;
}
