import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safe-storage";

/** Persisted find flags only — never the query string. */
export const SEARCH_FLAGS_KEY = "notes:search-flags";

export type SearchFlags = {
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
};

const defaults: SearchFlags = {
  caseSensitive: false,
  regexp: false,
  wholeWord: false,
};

export function loadSearchFlags(): SearchFlags {
  const raw = safeLocalStorageGet(SEARCH_FLAGS_KEY);
  if (!raw) return { ...defaults };
  try {
    const parsed = JSON.parse(raw) as Partial<SearchFlags>;
    return {
      caseSensitive: parsed.caseSensitive === true,
      regexp: parsed.regexp === true,
      wholeWord: parsed.wholeWord === true,
    };
  } catch {
    return { ...defaults };
  }
}

export function saveSearchFlags(flags: SearchFlags): void {
  safeLocalStorageSet(
    SEARCH_FLAGS_KEY,
    JSON.stringify({
      caseSensitive: !!flags.caseSensitive,
      regexp: !!flags.regexp,
      wholeWord: !!flags.wholeWord,
    }),
  );
}
