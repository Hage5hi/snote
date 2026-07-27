import type { Lang } from "./config";
import en from "./locales/en";
import type { Dictionary, TKey } from "./types";

type LazyLang = Exclude<Lang, "en">;

const localeLoaders = {
  vi: () => import("./locales/vi"),
  zh: () => import("./locales/zh"),
  ja: () => import("./locales/ja"),
  ko: () => import("./locales/ko"),
  fr: () => import("./locales/fr"),
  es: () => import("./locales/es"),
  de: () => import("./locales/de"),
  pt: () => import("./locales/pt"),
} satisfies Record<LazyLang, () => Promise<{ default: Dictionary }>>;

const loaded = new Map<Lang, Dictionary>([["en", en]]);
const pending = new Map<LazyLang, Promise<Dictionary>>();

export function getLoadedDictionary(lang: Lang): Dictionary | undefined {
  return loaded.get(lang);
}

export async function loadDictionary(lang: Lang): Promise<Dictionary> {
  const cached = loaded.get(lang);
  if (cached) return cached;
  const lazyLang = lang as LazyLang;
  const inFlight = pending.get(lazyLang);
  if (inFlight) return inFlight;

  const request = localeLoaders[lazyLang]().then((module) => {
    loaded.set(lang, module.default);
    pending.delete(lazyLang);
    return module.default;
  }, (error: unknown) => {
    pending.delete(lazyLang);
    throw error;
  });
  pending.set(lazyLang, request);
  return request;
}

export function translateLoaded(
  lang: Lang,
  key: TKey,
  vars?: Record<string, string | number>,
): string {
  const dictionary = loaded.get(lang) ?? en;
  const raw = dictionary[key] ?? en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}
