import { useCallback, useEffect, useState } from "react";

const KEY = "notes:focus-line";

// Focus-line highlight. Pairs with Typewriter mode (both emphasize the
// line being edited), but lives on its own toggle so users can enable
// either independently. CSS is gated on `html.focus-line` so the
// CodeMirror `highlightActiveLine()` extension — which is always
// installed — only shows its background when this flag is set.
export function useFocusLine() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(KEY) === "1";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (enabled) root.classList.add("focus-line");
    else root.classList.remove("focus-line");
    window.localStorage.setItem(KEY, enabled ? "1" : "0");
  }, [enabled]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);
  return { focusLine: enabled, toggle };
}
