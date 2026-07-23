import { createContext, useContext } from "react";
import type { Lang } from "./config";
import type { TKey } from "./types";

export {
  LANG_NAMES,
  STORAGE_KEY,
  SUPPORTED_LANGS,
  detectFromNavigator,
  detectLang,
  isLang,
  type Lang,
} from "./config";
export { loadDictionary, translateLoaded } from "./loaders";
export type { Dictionary, TKey } from "./types";

export interface I18nCtx {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

export const Ctx = createContext<I18nCtx | null>(null);

export function useI18n() {
  const context = useContext(Ctx);
  if (!context) throw new Error("useI18n must be used inside <I18nProvider>");
  return context;
}
