/**
 * Local snapshot history (disaster recovery).
 *
 * Stores up to MAX_SNAPSHOTS recent versions of a note's plaintext content
 * inside IndexedDB, keyed by slug. Designed to protect against accidental
 * "select all + delete" wipeouts that get propagated through Yjs.
 *
 * Two trigger paths:
 *  1. Periodic: `maybeSaveSnapshot` called on a 10-min cadence.
 *  2. Anti-disaster: `recordOnSuddenDelete` runs when a large amount of text
 *     vanishes within a short window.
 */

const DB_NAME = "note-snapshots";
const DB_VERSION = 1;
const STORE = "snapshots";
const MAX_SNAPSHOTS = 10;
const MIN_DIFF_CHARS = 50;
const PREVIEW_LEN = 200;

/**
 * Which code path created a snapshot. Legacy rows written before this field
 * existed are treated as `"periodic"` on read.
 */
export type SnapshotKind = "periodic" | "sudden_delete";

export interface Snapshot {
  id?: number;
  slug: string;
  ts: number;
  charCount: number;
  preview: string;
  content: string;
  kind?: SnapshotKind;
}

export function normalizeSnapshotKind(k: SnapshotKind | undefined): SnapshotKind {
  return k ?? "periodic";
}

export interface SnapshotFilter {
  /** Time window in ms; null = all time. */
  rangeMs?: number | null;
  /** "all" or a specific kind. */
  kind?: "all" | SnapshotKind;
  /** Reference "now" for range comparison. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * Pure filter used by both the UI and unit tests, so what the panel shows
 * always matches what the tests assert.
 */
export function filterSnapshots(items: Snapshot[], opts: SnapshotFilter = {}): Snapshot[] {
  const now = opts.now ?? Date.now();
  const rangeMs = opts.rangeMs ?? null;
  const kind = opts.kind ?? "all";
  return items.filter((s) => {
    if (rangeMs != null && now - s.ts > rangeMs) return false;
    if (kind !== "all" && normalizeSnapshotKind(s.kind) !== kind) return false;
    return true;
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("slug", "slug", { unique: false });
        store.createIndex("slug_ts", ["slug", "ts"], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    Promise.resolve(fn(store)).then((res) => {
      t.oncomplete = () => resolve(res);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }, reject);
  });
}

export async function listSnapshots(slug: string): Promise<Snapshot[]> {
  return tx("readonly", (store) => {
    return new Promise<Snapshot[]>((resolve, reject) => {
      const idx = store.index("slug");
      const req = idx.getAll(slug);
      req.onsuccess = () => {
        const arr = (req.result as Snapshot[]) || [];
        arr.sort((a, b) => b.ts - a.ts);
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

async function deleteSnapshot(id: number) {
  return tx("readwrite", (store) => store.delete(id));
}

async function trimSnapshots(slug: string) {
  const all = await listSnapshots(slug);
  const extras = all.slice(MAX_SNAPSHOTS);
  for (const s of extras) {
    if (s.id != null) await deleteSnapshot(s.id);
  }
}

async function insertSnapshot(snap: Omit<Snapshot, "id">) {
  await tx("readwrite", (store) => {
    store.add(snap);
  });
  await trimSnapshots(snap.slug);
}

/**
 * Save a snapshot only if it meaningfully differs from the most recent one.
 * Returns true if a snapshot was actually written.
 */
export async function maybeSaveSnapshot(slug: string, content: string): Promise<boolean> {
  if (!content) return false;
  const list = await listSnapshots(slug);
  const latest = list[0];
  if (latest && Math.abs(latest.charCount - content.length) < MIN_DIFF_CHARS && latest.content === content) {
    return false;
  }
  if (latest && latest.content === content) return false;
  await insertSnapshot({
    slug,
    ts: Date.now(),
    charCount: content.length,
    preview: content.slice(0, PREVIEW_LEN),
    content,
    kind: "periodic",
  });
  return true;
}

/**
 * Force-save a snapshot when a large delete is detected. Caller should pass
 * the *previous* content (i.e. before the delete propagates further).
 */
export async function recordOnSuddenDelete(slug: string, prevContent: string): Promise<boolean> {
  if (!prevContent || prevContent.length < 500) return false;
  const list = await listSnapshots(slug);
  const latest = list[0];
  if (latest && latest.content === prevContent) return false;
  await insertSnapshot({
    slug,
    ts: Date.now(),
    charCount: prevContent.length,
    preview: prevContent.slice(0, PREVIEW_LEN),
    content: prevContent,
    kind: "sudden_delete",
  });
  return true;
}

export async function clearSnapshots(slug: string) {
  const list = await listSnapshots(slug);
  for (const s of list) if (s.id != null) await deleteSnapshot(s.id);
}
