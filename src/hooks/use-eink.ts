import { useCallback, useEffect, useState } from "react";

const KEY = "notes:eink-mode";
type Pref = "auto" | "on" | "off";

function detectAuto(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  // E-readers typically report slow updates AND prefer reduced motion.
  return window.matchMedia("(update: slow)").matches;
}

export function useEink() {
  const [pref, setPref] = useState<Pref>(() => {
    if (typeof window === "undefined") return "auto";
    return ((window.localStorage.getItem(KEY) as Pref) || "auto");
  });
  const [autoActive, setAutoActive] = useState<boolean>(() => detectAuto());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(update: slow)");
    const onChange = () => setAutoActive(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const active = pref === "on" || (pref === "auto" && autoActive);

  useEffect(() => {
    const root = document.documentElement;
    if (active) root.classList.add("eink");
    else root.classList.remove("eink");
  }, [active]);

  useEffect(() => {
    window.localStorage.setItem(KEY, pref);
  }, [pref]);

  const setMode = useCallback((p: Pref) => setPref(p), []);
  return { pref, active, autoActive, setMode };
}
