/**
 * Local snapshot history (disaster recovery).
 *
 * Stores up to MAX_SNAPSHOTS recent versions of a note's plaintext content
 * inside IndexedDB for legacy notes, or ciphertext for encrypted notes, keyed
 * by slug. Designed to protect against accidental
 * "select all + delete" wipeouts that get propagated through Yjs.
 *
 * Two trigger paths:
 *  1. Periodic: `maybeSaveSnapshot` called on a 10-min cadence.
 *  2. Anti-disaster: `recordOnSuddenDelete` runs when a large amount of text
 *     vanishes within a short window.
 */

import { getEncryptionPinState } from "@/lib/encryption-pin";
import { base64ToBytes, bytesToBase64 } from "@/lib/yjs/base64";

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

export type SnapshotProtection = {
  encrypt: (bytes: Uint8Array) => Promise<Uint8Array>;
  decrypt: (bytes: Uint8Array) => Promise<Uint8Array>;
};

type StoredSnapshot = Omit<Snapshot, "preview" | "content"> & {
  preview?: string;
  content?: string;
  protected?: true;
  payload?: string;
};

const VALID_KINDS: readonly SnapshotKind[] = ["periodic", "sudden_delete"];

export function normalizeSnapshotKind(k: unknown): SnapshotKind {
  return (VALID_KINDS as readonly unknown[]).includes(k) ? (k as SnapshotKind) : "periodic";
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

async function listStoredSnapshots(slug: string): Promise<StoredSnapshot[]> {
  return tx("readonly", (store) => {
    return new Promise<StoredSnapshot[]>((resolve, reject) => {
      const idx = store.index("slug");
      const req = idx.getAll(slug);
      req.onsuccess = () => {
        const arr = (req.result as StoredSnapshot[]) || [];
        arr.sort((a, b) => b.ts - a.ts);
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

async function decodeStoredSnapshot(
  stored: StoredSnapshot,
  protection?: SnapshotProtection | null,
): Promise<Snapshot> {
  if (!stored.protected) {
    return {
      ...stored,
      preview: typeof stored.preview === "string" ? stored.preview : "",
      content: typeof stored.content === "string" ? stored.content : "",
    };
  }
  if (!protection) throw new Error("snapshot key required");
  if (typeof stored.payload !== "string" || stored.payload.length === 0) {
    throw new Error("invalid protected snapshot");
  }
  const plaintext = await protection.decrypt(base64ToBytes(stored.payload));
  const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as {
    content?: unknown;
  };
  if (typeof decoded.content !== "string" || decoded.content.length !== stored.charCount) {
    throw new Error("invalid protected snapshot");
  }
  return {
    id: stored.id,
    slug: stored.slug,
    ts: stored.ts,
    charCount: stored.charCount,
    kind: stored.kind,
    content: decoded.content,
    preview: decoded.content.slice(0, PREVIEW_LEN),
  };
}

export async function listSnapshots(
  slug: string,
  protection?: SnapshotProtection | null,
): Promise<Snapshot[]> {
  return Promise.all((await listStoredSnapshots(slug)).map((row) => decodeStoredSnapshot(row, protection)));
}

async function deleteSnapshot(id: number) {
  return tx("readwrite", (store) => store.delete(id));
}

async function trimSnapshots(slug: string) {
  const all = await listStoredSnapshots(slug);
  const extras = all.slice(MAX_SNAPSHOTS);
  for (const s of extras) {
    if (s.id != null) await deleteSnapshot(s.id);
  }
}

async function insertSnapshot(snap: Omit<StoredSnapshot, "id">) {
  await tx("readwrite", (store) => {
    store.add(snap);
  });
  await trimSnapshots(snap.slug);
}

async function encodeSnapshot(
  snap: Omit<Snapshot, "id">,
  protection?: SnapshotProtection | null,
): Promise<Omit<StoredSnapshot, "id">> {
  if (!protection) return snap;
  const plaintext = new TextEncoder().encode(JSON.stringify({ content: snap.content }));
  const ciphertext = await protection.encrypt(plaintext);
  if (ciphertext.byteLength === 0) throw new Error("empty protected snapshot");
  return {
    slug: snap.slug,
    ts: snap.ts,
    charCount: snap.charCount,
    kind: snap.kind,
    protected: true,
    payload: bytesToBase64(ciphertext),
  };
}

/**
 * Save a snapshot only if it meaningfully differs from the most recent one.
 * Returns true if a snapshot was actually written.
 */
export async function maybeSaveSnapshot(
  slug: string,
  content: string,
  protection?: SnapshotProtection | null,
): Promise<boolean> {
  if (!content) return false;
  if (!protection && getEncryptionPinState(slug) !== "clear") return false;
  const list = await listSnapshots(slug, protection);
  const latest = list[0];
  if (latest && Math.abs(latest.charCount - content.length) < MIN_DIFF_CHARS && latest.content === content) {
    return false;
  }
  if (latest && latest.content === content) return false;
  await insertSnapshot(await encodeSnapshot({
    slug,
    ts: Date.now(),
    charCount: content.length,
    preview: content.slice(0, PREVIEW_LEN),
    content,
    kind: "periodic",
  }, protection));
  return true;
}

/**
 * Force-save a snapshot when a large delete is detected. Caller should pass
 * the *previous* content (i.e. before the delete propagates further).
 */
export async function recordOnSuddenDelete(
  slug: string,
  prevContent: string,
  protection?: SnapshotProtection | null,
): Promise<boolean> {
  if (!prevContent || prevContent.length < 500) return false;
  if (!protection && getEncryptionPinState(slug) !== "clear") return false;
  const list = await listSnapshots(slug, protection);
  const latest = list[0];
  if (latest && latest.content === prevContent) return false;
  await insertSnapshot(await encodeSnapshot({
    slug,
    ts: Date.now(),
    charCount: prevContent.length,
    preview: prevContent.slice(0, PREVIEW_LEN),
    content: prevContent,
    kind: "sudden_delete",
  }, protection));
  return true;
}

/** Encrypt every legacy plaintext row atomically before a note becomes locked. */
export async function protectExistingSnapshots(slug: string, protection: SnapshotProtection) {
  const rows = await listStoredSnapshots(slug);
  const converted = await Promise.all(rows.map(async (row) => {
    if (row.protected) return row;
    const decoded = await decodeStoredSnapshot(row);
    return {
      ...await encodeSnapshot(decoded, protection),
      id: row.id,
    } satisfies StoredSnapshot;
  }));
  await tx("readwrite", (store) => {
    for (const row of converted) store.put(row);
  });
}

/** Restore plaintext history while the old key is still available during an explicit unlock. */
export async function unprotectExistingSnapshots(slug: string, protection: SnapshotProtection) {
  const rows = await listStoredSnapshots(slug);
  const converted = await Promise.all(rows.map(async (row) => {
    if (!row.protected) return row;
    const decoded = await decodeStoredSnapshot(row, protection);
    return {
      id: row.id,
      slug: decoded.slug,
      ts: decoded.ts,
      charCount: decoded.charCount,
      preview: decoded.preview,
      content: decoded.content,
      kind: decoded.kind,
    } satisfies StoredSnapshot;
  }));
  await tx("readwrite", (store) => {
    for (const row of converted) store.put(row);
  });
}

export async function clearSnapshots(slug: string) {
  const list = await listStoredSnapshots(slug);
  for (const s of list) if (s.id != null) await deleteSnapshot(s.id);
}
