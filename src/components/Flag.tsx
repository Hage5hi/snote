// Cross-platform country flag: renders an SVG from flagcdn so flags look
// identical on Windows/Linux/macOS/Android/iOS (Windows has no native flag
// emoji font, which is why 🇺🇸 falls back to "US" text).
import type { Lang } from "@/i18n";

const LANG_TO_COUNTRY: Record<Lang, string> = {
  en: "us",
  vi: "vn",
  zh: "cn",
  ja: "jp",
  ko: "kr",
  fr: "fr",
  es: "es",
  de: "de",
  pt: "pt",
};

interface FlagProps {
  lang: Lang;
  className?: string;
  /** Width in px. Height auto-scales to 3:4 ratio. */
  size?: number;
}

export function Flag({ lang, className, size = 20 }: FlagProps) {
  const cc = LANG_TO_COUNTRY[lang];
  return (
    <img
      src={`https://flagcdn.com/${cc}.svg`}
      alt=""
      aria-hidden
      width={size}
      height={Math.round((size * 3) / 4)}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={
        "inline-block shrink-0 rounded-[2px] object-cover ring-1 ring-border/40 " +
        (className ?? "")
      }
      style={{ width: size, height: Math.round((size * 3) / 4) }}
    />
  );
}
