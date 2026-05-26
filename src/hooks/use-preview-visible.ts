import { useCallback, useEffect, useState } from "react";

// Persist the preview-pane visibility per device/browser so we don't nag the
// user to re-toggle every session.
//
// First-visit defaults:
//   - Wide viewport (≥ 900 px): preview ON — both panes fit side-by-side, so
//     showing the rendered output up front is helpful.
//   - Narrow viewport (< 900 px): preview OFF — only one pane shows at a
//     time, and a brand-new note has nothing to render. Landing on the
//     editor lets the user start typing immediately.
// After the first toggle the stored "1"/"0" wins regardless of viewport.
const KEY = "notes:preview-visible";

export function usePreviewVisible() {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) {
      const narrow = window.matchMedia("(max-width: 899px)").matches;
      return !narrow;
    }
    return raw === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(KEY, visible ? "1" : "0");
  }, [visible]);

  const toggle = useCallback(() => setVisible((v) => !v), []);
  return { visible, toggle, setVisible };
}
