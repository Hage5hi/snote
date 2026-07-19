import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Ctx,
  STORAGE_KEY,
  detectLang,
  dict,
  isLang,
  type I18nCtx,
  type Lang,
} from "./index";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang());

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
    // Notify same-tab listeners (e.g. PWA update toast) — `storage` events
    // only fire across tabs, not within the tab that wrote the value.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("i18n:lang-changed", { detail: l }));
    }
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
