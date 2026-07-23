import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { safeLocalStorageSet } from "@/lib/safe-storage";
import {
  Ctx,
  STORAGE_KEY,
  detectLang,
  isLang,
  type I18nCtx,
  type Lang,
} from "./index";
import { getLoadedDictionary, loadDictionary } from "./loaders";
import en from "./locales/en";
import type { Dictionary } from "./types";

type LoadedCatalog = {
  lang: Lang;
  dictionary: Dictionary;
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang());
  const [catalog, setCatalog] = useState<LoadedCatalog>({ lang: "en", dictionary: en });

  const setLang = useCallback((nextLang: Lang) => {
    setLangState(nextLang);
    safeLocalStorageSet(STORAGE_KEY, nextLang);
    // Storage events only fire across tabs. Notify same-tab consumers such as
    // the PWA update toast immediately, then once more when the locale loads.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("i18n:lang-changed", { detail: nextLang }),
      );
    }
  }, []);

  // Render the English fallback while a requested locale chunk arrives. The
  // cleanup guard prevents a slower, older import from winning a rapid switch.
  useEffect(() => {
    let cancelled = false;
    const cached = getLoadedDictionary(lang);
    if (cached) {
      setCatalog({ lang, dictionary: cached });
      return () => {
        cancelled = true;
      };
    }

    void loadDictionary(lang).then(
      (dictionary) => {
        if (cancelled) return;
        setCatalog({ lang, dictionary });
        window.dispatchEvent(new CustomEvent("i18n:lang-changed", { detail: lang }));
      },
      () => {
        // A failed locale chunk leaves the app usable with English fallback.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [lang]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && isLang(event.newValue)) {
        setLangState(event.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const dictionary = catalog.lang === lang ? catalog.dictionary : en;
  const value = useMemo<I18nCtx>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => {
        const raw = dictionary[key] ?? en[key] ?? key;
        if (!vars) return raw;
        return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
          String(vars[name] ?? ""),
        );
      },
    }),
    [dictionary, lang, setLang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
