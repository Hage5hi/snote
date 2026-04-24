import { useCallback, useEffect, useState } from "react";

// Show the Markdown preview pane by default for new users; persist the user's
// choice per device/browser so we don't nag them to re-toggle every session.
const KEY = "notes:preview-visible";

export function usePreviewVisible() {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(KEY);
    // First-time users → default ON. After the first toggle the stored value
    // ("1" / "0") wins, so returning-users keep whatever they picked.
    if (raw === null) return true;
    return raw === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(KEY, visible ? "1" : "0");
  }, [visible]);

  const toggle = useCallback(() => setVisible((v) => !v), []);
  return { visible, toggle, setVisible };
}
