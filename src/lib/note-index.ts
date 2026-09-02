/**
 * Client-only note knowledge index.
 *
 * Privacy boundary: titles, headings, and outgoing wiki-link slugs are derived
 * only from plaintext this browser has already decrypted or typed, plus Home
 * recents/pins metadata (slug and optional preview). The graph lives in memory
 * and IndexedDB on this device. Never upload plaintext, titles, headings, or
 * link graphs to the server. Encrypted notes are indexed only after a
 * successful unlock in this session.
 */
import { getPinned, getRecents } from "@/lib/recent-notes";
import {
  backlinksTo,
  buildNoteGraphRecord,
  deadOutgoing,
  isOrphanNote,
  type NoteGraphRecord,
} from "@/lib/note-graph";
import { emitWikiKnownChange, setWikiLinkDeadLookup } from "@/lib/wiki-link";

export type NoteIndexEntry = NoteGraphRecord & {
  updatedAt: number;
  source: "plaintext" | "metadata";
};

const DB_NAME = "snote-knowledge-index";
const DB_VERSION = 1;
const STORE = "notes";
const MAX_ENTRIES = 400;

const memory = new Map<string, NoteIndexEntry>();
const seenNonEmpty = new Set<string>();
const listeners = new Set<() => void>();
let dbPromise: Promise<IDBDatabase> | null = null;
let hydrated = false;
let hydrateInFlight: Promise<void> | null = null;
let persistQueue: Promise<void> = Promise.resolve();

function isDeadTarget(slug: string): boolean {
  if (memory.size === 0) return false;
  return !memory.has(slug);
}

setWikiLinkDeadLookup(isDeadTarget);

function notify() {
  emitWikiKnownChange();
  for (const listener of listeners) listener();
}

export function subscribeNoteIndex(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getNoteIndexSnapshot(): NoteIndexEntry[] {
  return [...memory.values()];
}

export function getKnownSlugs(): Set<string> {
  return new Set(memory.keys());
}

export function getBacklinks(slug: string): NoteIndexEntry[] {
  return backlinksTo(getNoteIndexSnapshot(), slug) as NoteIndexEntry[];
}

export function listDeadOutgoing(slug: string, liveOutgoing?: readonly string[]): string[] {
  const outgoing = liveOutgoing ?? memory.get(slug)?.outgoingLinks ?? [];
  return deadOutgoing(outgoing, getKnownSlugs());
}

export function noteIsOrphan(slug: string, liveOutgoing?: readonly string[]): boolean {
  const outgoingCount = (liveOutgoing ?? memory.get(slug)?.outgoingLinks ?? []).length;
  return isOrphanNote(outgoingCount, getBacklinks(slug).length);
}

function graphUnchanged(prev: NoteIndexEntry | undefined, next: NoteIndexEntry): boolean {
  if (!prev) return false;
  return prev.source === next.source
    && prev.title === next.title
    && prev.headings.join("\0") === next.headings.join("\0")
    && prev.outgoingLinks.join("\0") === next.outgoingLinks.join("\0");
}

export function rememberMetadata(slug: string, title?: string) {
  const trimmed = slug.trim();
  if (!trimmed) return;
  const prev = memory.get(trimmed);
  if (prev?.source === "plaintext") return;
  const next: NoteIndexEntry = {
    slug: trimmed,
    title: title?.trim() || prev?.title,
    headings: prev?.headings ?? [],
    outgoingLinks: prev?.outgoingLinks ?? [],
    updatedAt: Date.now(),
    source: "metadata",
  };
  if (graphUnchanged(prev, next)) return;
  memory.set(trimmed, next);
  trimMemory();
  notify();
}

export function upsertPlaintextNote(slug: string, content: string) {
  const trimmedSlug = slug.trim();
  if (!trimmedSlug) return;
  const trimmed = content.trim();
  if (
    !trimmed
    && !seenNonEmpty.has(trimmedSlug)
    && memory.get(trimmedSlug)?.source === "plaintext"
  ) {
    // First paint can be empty while Yjs hydrates. Keep the previous graph.
    return;
  }
  if (trimmed) seenNonEmpty.add(trimmedSlug);
  const graph = buildNoteGraphRecord(trimmedSlug, content);
  const next: NoteIndexEntry = {
    ...graph,
    updatedAt: Date.now(),
    source: "plaintext",
  };
  if (graphUnchanged(memory.get(trimmedSlug), next)) return;
  memory.set(trimmedSlug, next);
  trimMemory();
  notify();
  queuePersist(next);
}

function trimMemory() {
  if (memory.size <= MAX_ENTRIES) return;
  const entries = [...memory.values()].sort((a, b) => {
    if (a.source !== b.source) return a.source === "metadata" ? -1 : 1;
    return a.updatedAt - b.updatedAt;
  });
  while (memory.size > MAX_ENTRIES && entries.length > 0) {
    const drop = entries.shift();
    if (!drop) break;
    memory.delete(drop.slug);
    persistQueue = persistQueue.then(() => removePersisted(drop.slug)).catch(() => {});
  }
}

function mergeHomeMetadata() {
  for (const recent of getRecents()) {
    const prev = memory.get(recent.slug);
    if (prev) continue;
    memory.set(recent.slug, {
      slug: recent.slug,
      title: recent.preview?.slice(0, 200) || undefined,
      headings: [],
      outgoingLinks: [],
      updatedAt: recent.lastOpenedAt,
      source: "metadata",
    });
  }
  for (const slug of getPinned()) {
    if (memory.has(slug)) continue;
    memory.set(slug, {
      slug,
      headings: [],
      outgoingLinks: [],
      updatedAt: Date.now(),
      source: "metadata",
    });
  }
}

export async function hydrateNoteIndex(): Promise<void> {
  if (hydrated) {
    const before = memory.size;
    mergeHomeMetadata();
    if (memory.size !== before) notify();
    return;
  }
  if (hydrateInFlight) return hydrateInFlight;
  hydrateInFlight = (async () => {
    let changed = false;
    try {
      const rows = await loadAll();
      for (const row of rows) {
        const prev = memory.get(row.slug);
        if (prev?.source === "plaintext" && row.source !== "plaintext") continue;
        if (prev && prev.updatedAt > row.updatedAt) continue;
        memory.set(row.slug, row);
        changed = true;
      }
    } catch {
      // IndexedDB can be missing or blocked; memory still works.
    }
    const beforeMeta = memory.size;
    mergeHomeMetadata();
    if (memory.size !== beforeMeta) changed = true;
    hydrated = true;
    hydrateInFlight = null;
    if (changed) notify();
  })();
  return hydrateInFlight;
}

export function whenNoteIndexIdle(): Promise<void> {
  return persistQueue;
}

export async function resetNoteIndexForTests(opts?: { dropDatabase?: boolean }) {
  await persistQueue.catch(() => {});
  memory.clear();
  seenNonEmpty.clear();
  hydrated = false;
  hydrateInFlight = null;
  listeners.clear();
  setWikiLinkDeadLookup(isDeadTarget);
  if (typeof indexedDB === "undefined") return;
  const dropDatabase = opts?.dropDatabase !== false;
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      /* ignore */
    }
    dbPromise = null;
  }
  persistQueue = Promise.resolve();
  if (!dropDatabase) return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function queuePersist(entry: NoteIndexEntry) {
  persistQueue = persistQueue.then(() => persist(entry)).catch(() => {});
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "slug" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("IndexedDB unavailable"));
    };
  });
  return dbPromise;
}

async function persist(entry: NoteIndexEntry) {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(entry);
    });
  } catch {
    /* private-mode / blocked IDB — memory still holds the graph */
  }
}

async function removePersisted(slug: string) {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(slug);
    });
  } catch {
    /* ignore */
  }
}

async function loadAll(): Promise<NoteIndexEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? request.result : [];
      resolve(rows.filter(isIndexEntry));
    };
    request.onerror = () => reject(request.error);
  });
}

function isIndexEntry(value: unknown): value is NoteIndexEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as NoteIndexEntry;
  return typeof row.slug === "string"
    && Array.isArray(row.outgoingLinks)
    && (row.source === "plaintext" || row.source === "metadata");
}
