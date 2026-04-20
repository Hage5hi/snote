import { useCallback, useEffect, useState } from "react";

const KEY = "notes:eink-mode";
const EVENT = "notes:eink-mode-change";
type Pref = "auto" | "on" | "off";

function detectAuto(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  // E-readers typically report slow updates AND prefer reduced motion.
  return window.matchMedia("(update: slow)").matches;
}

function readPref(): Pref {
  if (typeof window === "undefined") return "auto";
  return ((window.localStorage.getItem(KEY) as Pref) || "auto");
}

export function useEink() {
  const [pref, setPref] = useState<Pref>(() => readPref());
  const [autoActive, setAutoActive] = useState<boolean>(() => detectAuto());

  // Watch the auto-detect media query.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(update: slow)");
    const onChange = () => setAutoActive(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Sync state across hook instances (same tab via custom event, cross-tab via storage).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setPref(readPref());
    };
    const onCustom = () => setPref(readPref());
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT, onCustom as EventListener);
    };
  }, []);

  const active = pref === "on" || (pref === "auto" && autoActive);

  // Idempotent class toggle on <html>.
  useEffect(() => {
    const root = document.documentElement;
    const has = root.classList.contains("eink");
    if (active && !has) root.classList.add("eink");
    else if (!active && has) root.classList.remove("eink");
  }, [active]);

  const setMode = useCallback((p: Pref) => {
    setPref(p);
    try {
      window.localStorage.setItem(KEY, p);
      window.dispatchEvent(new CustomEvent(EVENT));
    } catch {
      // ignore
    }
  }, []);

  return { pref, active, autoActive, setMode };
}
