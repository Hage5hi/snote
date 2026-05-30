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
  /** Hint to the browser. Dropdown flags use "low" so they don't compete
   *  with the trigger flag on first paint. */
  priority?: "high" | "low" | "auto";
}

export function Flag({ lang, className, size = 20, priority = "auto" }: FlagProps) {
  const cc = LANG_TO_COUNTRY[lang];
  const h = Math.round((size * 3) / 4);
  return (
    <img
      src={`https://flagcdn.com/${cc}.svg`}
      alt=""
      aria-hidden
      width={size}
      height={h}
      loading="lazy"
      decoding="async"
      // @ts-expect-error — fetchPriority is a valid HTML attribute, types lag
      fetchpriority={priority}
      draggable={false}
      className={
        "inline-block shrink-0 rounded-[2px] object-cover ring-1 ring-foreground/20 " +
        (className ?? "")
      }
      style={{ width: size, height: h }}
    />
  );
}
