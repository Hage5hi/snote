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

export interface Snapshot {
  id?: number;
  slug: string;
  ts: number;
  charCount: number;
  preview: string;
  content: string;
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
  });
  return true;
}

export async function clearSnapshots(slug: string) {
  const list = await listSnapshots(slug);
  for (const s of list) if (s.id != null) await deleteSnapshot(s.id);
}
