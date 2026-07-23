export type Lang = "en" | "vi" | "zh" | "ja" | "ko" | "fr" | "es" | "de" | "pt";

export const SUPPORTED_LANGS: Lang[] = ["en", "vi", "zh", "ja", "ko", "fr", "es", "de", "pt"];

export const LANG_NAMES: Record<Lang, { native: string; flag: string }> = {
  en: { native: "English", flag: "🇺🇸" },
  vi: { native: "Tiếng Việt", flag: "🇻🇳" },
  zh: { native: "中文", flag: "🇨🇳" },
  ja: { native: "日本語", flag: "🇯🇵" },
  ko: { native: "한국어", flag: "🇰🇷" },
  fr: { native: "Français", flag: "🇫🇷" },
  es: { native: "Español", flag: "🇪🇸" },
  de: { native: "Deutsch", flag: "🇩🇪" },
  pt: { native: "Português", flag: "🇵🇹" },
};

export const STORAGE_KEY = "lang";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (SUPPORTED_LANGS as string[]).includes(value);
}

export function detectFromNavigator(): Lang {
  if (typeof navigator === "undefined") return "en";
  const languages = (
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language || "en"]
  ) as string[];
  for (const raw of languages) {
    const lang = raw.toLowerCase();
    if (lang.startsWith("vi")) return "vi";
    if (lang.startsWith("zh")) return "zh";
    if (lang.startsWith("ja")) return "ja";
    if (lang.startsWith("ko")) return "ko";
    if (lang.startsWith("fr")) return "fr";
    if (lang.startsWith("es")) return "es";
    if (lang.startsWith("de")) return "de";
    if (lang.startsWith("pt")) return "pt";
    if (lang.startsWith("en")) return "en";
  }
  return "en";
}

export function detectLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (isLang(saved)) return saved;
    } catch {
      // Storage can be unavailable in privacy mode or sandboxed embeds.
    }
  }
  return detectFromNavigator();
}
