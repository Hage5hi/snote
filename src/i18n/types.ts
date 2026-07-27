import en from "./locales/en";

export type TKey = keyof typeof en;
export type Dictionary = Record<TKey, string>;
