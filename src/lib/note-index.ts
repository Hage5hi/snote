/**
 * Client-only note knowledge index.
 *
 * Privacy boundary — sources, and only these:
 *   1. Live Y.Text after the encryption gate has unlocked this session
 *      (NotePage never mounts plaintext y-indexeddb for encrypted or
 *      capability notes; this module never opens `note:${slug}` / Yjs IDB).
 *   2. Home recents/pins: slug only, never preview/body.
 *
 * Derived `{ title, headings, outgoingLinks }` may be persisted to this
 * module's own IDB store only for unencrypted legacy notes (already
 * plaintext on device). Encrypted/capability graphs stay in session memory
 * so a later visit without unlock cannot reload titles or link graphs.
 *
 * Never upload plaintext, titles, headings, or link graphs to the server.
 * Never invent a server-side note list. Home has no vault listing.
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
  /**
   * Short body excerpt from live Y.Text this session. Never written to the
   * knowledge IDB store. Recents preview stays in localStorage and is attached
   * only at search time.
   */
  snippet?: string;
};

const DB_NAME = "snote-knowledge-index";
/** v2 clears v1 rows that may have persisted encrypted-session graphs. */
const DB_VERSION = 2;
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

export function isNoteIndexHydrated(): boolean {
  return hydrated;
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
    && prev.outgoingLinks.join("\0") === next.outgoingLinks.join("\0")
    && (prev.tags ?? []).join("\0") === (next.tags ?? []).join("\0");
}

/** Remember a slug (recents/pins / current note) without storing body or title. */
export function rememberMetadata(slug: string) {
  const trimmed = slug.trim();
  if (!trimmed) return;
  const prev = memory.get(trimmed);
  if (prev?.source === "plaintext") return;
  const next: NoteIndexEntry = {
    slug: trimmed,
    title: prev?.title,
    headings: prev?.headings ?? [],
    outgoingLinks: prev?.outgoingLinks ?? [],
    tags: prev?.tags ?? [],
    updatedAt: Date.now(),
    source: "metadata",
  };
  if (graphUnchanged(prev, next)) return;
  memory.set(trimmed, next);
  trimMemory();
  notify();
}

export type UpsertPlaintextOptions = {
  /**
   * Persist the derived graph to the knowledge IDB store. Pass true only for
   * unencrypted legacy notes. Encrypted/capability notes must stay session-only.
   */
  durable?: boolean;
};

export function upsertPlaintextNote(
  slug: string,
  content: string,
  opts?: UpsertPlaintextOptions,
) {
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
  const prev = memory.get(trimmedSlug);
  const next: NoteIndexEntry = {
    ...graph,
    updatedAt: Date.now(),
    source: "plaintext",
    snippet: sessionSnippet(content),
  };
  if (graphUnchanged(prev, next) && prev?.snippet === next.snippet) return;
  memory.set(trimmedSlug, next);
  if (graphUnchanged(prev, next)) return;
  trimMemory();
  notify();
  if (opts?.durable) queuePersist(next);
}

const MAX_SNIPPET = 180;

function sessionSnippet(content: string): string | undefined {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET).trimEnd()}…` : text;
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
      headings: [],
      outgoingLinks: [],
      tags: [],
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
      tags: [],
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
        memory.set(row.slug, { ...row, tags: row.tags ?? [], snippet: undefined });
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
  if (entry.source !== "plaintext") return;
  persistQueue = persistQueue.then(() => persist(entry)).catch(() => {});
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "slug" });
      }
      // Drop v1: the first Phase 1 commit persisted every plaintext upsert,
      // including encrypted notes unlocked in that session.
      if (event.oldVersion > 0 && event.oldVersion < 2) {
        request.transaction?.objectStore(STORE).clear();
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
      tx.objectStore(STORE).put(persistableRow(entry));
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
      resolve(rows.filter((row) => isIndexEntry(row) && row.source === "plaintext"));
    };
    request.onerror = () => reject(request.error);
  });
}

function persistableRow(entry: NoteIndexEntry): Omit<NoteIndexEntry, "snippet"> {
  const { snippet: _snippet, ...row } = entry;
  return row;
}

function isIndexEntry(value: unknown): value is NoteIndexEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as NoteIndexEntry;
  return typeof row.slug === "string"
    && Array.isArray(row.outgoingLinks)
    && (row.source === "plaintext" || row.source === "metadata");
}
