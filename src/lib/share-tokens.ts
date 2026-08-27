// Per-device cache of active read-only share tokens for slugs the user
// owns. Server is the source of truth; this is purely a UX shortcut so the
// ShareDialog can show the existing link without a round-trip every open.
//
// With the "one link per slug" contract, we only ever keep a single
// (slug, token) pair in this map.

const KEY = "notes:share-tokens";

type Store = Record<string, string>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Store;
  } catch {
    // corrupt — fall through to empty
  }
  return {};
}

function write(store: Store) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // quota — ignore
  }
}

export function getShareToken(slug: string): string | null {
  return read()[slug] ?? null;
}

export function clearShareToken(slug: string) {
  const store = read();
  delete store[slug];
  write(store);
}
