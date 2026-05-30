import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Ctx,
  STORAGE_KEY,
  countryToLang,
  detectLang,
  dict,
  isLang,
  type I18nCtx,
  type Lang,
} from "./index";

const IP_DETECTED_KEY = "lang.ip_detected";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang());

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
      // Once the user picks manually, never auto-override.
      localStorage.setItem(IP_DETECTED_KEY, "1");
    } catch {
      // ignore
    }
    // Notify same-tab listeners (e.g. PWA update toast) — `storage` events
    // only fire across tabs, not within the tab that wrote the value.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("i18n:lang-changed", { detail: l }));
    }
  }, []);

  // First visit: try IP-based geolocation to refine the initial language.
  // Only runs when no saved choice and no prior IP attempt — silent on failure.
  useEffect(() => {
    let cancelled = false;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
      if (localStorage.getItem(IP_DETECTED_KEY)) return;
    } catch {
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 2500);
    fetch("https://ipapi.co/json/", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { country_code?: string } | null) => {
        if (cancelled || !data) return;
        // Race-safety: if the user picked a language during the fetch window,
        // their explicit choice wins over the IP guess.
        try {
          if (localStorage.getItem(STORAGE_KEY)) return;
        } catch {
          // ignore
        }
        const guessed = countryToLang(data.country_code);
        if (guessed) {
          setLangState(guessed);
          try {
            localStorage.setItem(STORAGE_KEY, guessed);
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // Network/CORS/timeout — keep navigator-detected language.
      })
      .finally(() => {
        window.clearTimeout(timer);
        try {
          localStorage.setItem(IP_DETECTED_KEY, "1");
        } catch {
          // ignore
        }
      });
    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, []);

  // Keep tabs in sync if user changes language in another tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isLang(e.newValue)) setLangState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Keep <html lang="..."> in sync for accessibility/SEO.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const value = useMemo<I18nCtx>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => {
        const raw =
          (dict[lang] as Record<string, string>)[key] ??
          (dict.en as Record<string, string>)[key] ??
          key;
        if (!vars) return raw;
        return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
      },
    }),
    [lang, setLang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
