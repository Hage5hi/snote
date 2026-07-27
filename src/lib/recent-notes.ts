// Track recently opened notes in localStorage, with optional pinning.
// Pinned notes are kept on top in Cmd+K and never trimmed by MAX.
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "@/lib/safe-storage";

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
    const raw = safeLocalStorageGet(KEY);
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
  safeLocalStorageSet(KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function removeRecent(slug: string) {
  const next = getRecents().filter((r) => r.slug !== slug);
  safeLocalStorageSet(KEY, JSON.stringify(next));
  return next;
}

export function clearRecents() {
  safeLocalStorageRemove(KEY);
}

// ─── Pinned slugs ─────────────────────────────────────────────────────────

export function getPinned(): string[] {
  try {
    const raw = safeLocalStorageGet(PIN_KEY);
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
  safeLocalStorageSet(PIN_KEY, JSON.stringify(next));
  return next;
}

