/**
 * Home library helpers: tag filter over knowledge-index metadata and
 * browser-local virtual collections. Recents/pins stay slug-only; this
 * module never reads note bodies, Yjs, or ciphertext.
 */
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "@/lib/safe-storage";
import { parseTagQuery } from "@/lib/tags";

export type TagFilter = {
  /** True when the user typed a query. Incomplete `#` is active with no tags. */
  active: boolean;
  tags: string[];
};

export type VirtualCollection = {
  id: string;
  name: string;
  tags: string[];
};

const COLLECTIONS_KEY = "note.collections";
const MAX_COLLECTIONS = 30;
const MAX_NAME = 80;

export function parseHomeTagFilter(raw: string): TagFilter {
  const trimmed = raw.trim();
  if (!trimmed) return { active: false, tags: [] };
  return { active: true, tags: parseTagQuery(trimmed) };
}

export function noteMatchesTagFilter(
  tags: readonly string[] | undefined,
  filter: TagFilter,
): boolean {
  if (!filter.active) return true;
  if (filter.tags.length === 0) return false;
  if (!tags || tags.length === 0) return false;
  const have = new Set(tags);
  return filter.tags.every((tag) => have.has(tag));
}

export function indexTagsBySlug(
  entries: readonly { slug: string; tags?: string[] }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const entry of entries) {
    map.set(entry.slug, entry.tags ?? []);
  }
  return map;
}

export function filterByIndexTags<T extends { slug: string }>(
  items: readonly T[],
  tagsBySlug: ReadonlyMap<string, string[]>,
  filter: TagFilter,
): T[] {
  if (!filter.active) return [...items];
  return items.filter((item) => noteMatchesTagFilter(tagsBySlug.get(item.slug), filter));
}

export function filterPinnedByIndexTags(
  slugs: readonly string[],
  tagsBySlug: ReadonlyMap<string, string[]>,
  filter: TagFilter,
): string[] {
  if (!filter.active) return [...slugs];
  return slugs.filter((slug) => noteMatchesTagFilter(tagsBySlug.get(slug), filter));
}

export function getCollections(): VirtualCollection[] {
  try {
    const raw = safeLocalStorageGet(COLLECTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCollection);
  } catch {
    return [];
  }
}

export function upsertCollection(input: {
  id?: string;
  name: string;
  tags: string[];
}): VirtualCollection | null {
  const name = input.name.trim().slice(0, MAX_NAME);
  const tags = parseTagQuery(input.tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" "));
  if (!name || tags.length === 0) return null;
  const list = getCollections();
  const existing = input.id ? list.find((row) => row.id === input.id) : undefined;
  const next: VirtualCollection = {
    id: existing?.id ?? newCollectionId(),
    name,
    tags,
  };
  if (existing) {
    const idx = list.findIndex((row) => row.id === existing.id);
    list[idx] = next;
  } else {
    if (list.length >= MAX_COLLECTIONS) return null;
    list.push(next);
  }
  persistCollections(list);
  return next;
}

export function deleteCollection(id: string): VirtualCollection[] {
  const next = getCollections().filter((row) => row.id !== id);
  persistCollections(next);
  return next;
}

function persistCollections(list: VirtualCollection[]) {
  safeLocalStorageSet(COLLECTIONS_KEY, JSON.stringify(list.map(persistableCollection)));
}

function persistableCollection(row: VirtualCollection): VirtualCollection {
  return { id: row.id, name: row.name, tags: row.tags };
}

function isCollection(value: unknown): value is VirtualCollection {
  if (!value || typeof value !== "object") return false;
  const row = value as VirtualCollection;
  return typeof row.id === "string"
    && typeof row.name === "string"
    && Array.isArray(row.tags)
    && row.tags.every((tag) => typeof tag === "string");
}

function newCollectionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
