// Static all-locale catalog for build-time scripts and tests only.
// Runtime modules must use loaders.ts so non-English dictionaries stay lazy.
import de from "./locales/de";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import ja from "./locales/ja";
import ko from "./locales/ko";
import pt from "./locales/pt";
import vi from "./locales/vi";
import zh from "./locales/zh";

export const dict = { en, vi, zh, ja, ko, fr, es, de, pt } as const;
