// Track recently opened notes in localStorage, with optional pinning.
// Pinned notes are kept on top in Cmd+K and never trimmed by MAX.
const KEY = "note.recents";
const PIN_KEY = "note.pinned";
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

// ─── Pinned slugs ─────────────────────────────────────────────────────────

export function getPinned(): string[] {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function isPinned(slug: string): boolean {
  return getPinned().includes(slug);
}

export function togglePin(slug: string): string[] {
  const list = getPinned();
  const next = list.includes(slug) ? list.filter((s) => s !== slug) : [slug, ...list];
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

// ─── Rename helpers ───────────────────────────────────────────────────────
// Used when a note's slug changes. Keeps recents/pinned pointing at new URL
// so Cmd+K and pin star don't break.

export function renameRecent(oldSlug: string, newSlug: string) {
  const list = getRecents();
  const idx = list.findIndex((r) => r.slug === oldSlug);
  if (idx === -1) return;
  // Remove any pre-existing entry for newSlug to avoid duplicates.
  const filtered = list.filter((r) => r.slug !== newSlug);
  const i2 = filtered.findIndex((r) => r.slug === oldSlug);
  if (i2 !== -1) filtered[i2] = { ...filtered[i2], slug: newSlug };
  try {
    localStorage.setItem(KEY, JSON.stringify(filtered));
  } catch {}
}

export function renamePinned(oldSlug: string, newSlug: string) {
  const list = getPinned();
  if (!list.includes(oldSlug)) return;
  const next = Array.from(new Set(list.map((s) => (s === oldSlug ? newSlug : s))));
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(next));
  } catch {}
}
