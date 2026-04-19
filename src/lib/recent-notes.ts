// Track recently opened notes in localStorage.
const KEY = "note.recents";
const MAX = 50;

export type RecentNote = {
  slug: string;
  lastOpenedAt: number;
  preview?: string;
};

export function getRecents(): RecentNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentNote[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function touchRecent(slug: string, preview?: string) {
  const list = getRecents().filter((r) => r.slug !== slug);
  list.unshift({ slug, lastOpenedAt: Date.now(), preview });
  const trimmed = list.slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {}
  return trimmed;
}

export function removeRecent(slug: string) {
  const next = getRecents().filter((r) => r.slug !== slug);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearRecents() {
  localStorage.removeItem(KEY);
}
