import type { PendingUpdate } from "@/lib/capability/client";

export type OutboxUpdate = PendingUpdate & {
  noteId: string;
  createdAt: number;
};

const DEFAULT_DB_NAME = "snote-capability-sync";
const STORE = "updates";
const DB_VERSION = 1;
const MAX_GET_ALL_COUNT = 0xffff_ffff;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class CapabilityOutbox {
  private database: Promise<IDBDatabase>;

  constructor(private readonly databaseName = DEFAULT_DB_NAME) {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: ["noteId", "updateId"] });
          store.createIndex("note_created", ["noteId", "createdAt"], { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
    });
  }

  async enqueue(update: OutboxUpdate): Promise<void> {
    const db = await this.database;
    const transaction = db.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE);
    const key: [string, string] = [update.noteId, update.updateId];
    const existing = await requestResult(store.get(key));
    if (!existing) store.add(update);
    await done;
  }

  async list(noteId: string, limit = 100): Promise<OutboxUpdate[]> {
    const db = await this.database;
    const transaction = db.transaction(STORE, "readonly");
    const done = transactionDone(transaction);
    const index = transaction.objectStore(STORE).index("note_created");
    const range = IDBKeyRange.bound([noteId, 0], [noteId, Number.MAX_SAFE_INTEGER]);
    const rows = await requestResult(index.getAll(range, Math.min(limit, MAX_GET_ALL_COUNT))) as OutboxUpdate[];
    await done;
    return rows.sort((a, b) => a.createdAt - b.createdAt || a.updateId.localeCompare(b.updateId));
  }

  async acknowledge(noteId: string, updateIds: string[]): Promise<void> {
    if (updateIds.length === 0) return;
    const db = await this.database;
    const transaction = db.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE);
    for (const updateId of new Set(updateIds)) store.delete([noteId, updateId]);
    await done;
  }

  async clear(noteId: string): Promise<void> {
    const rows = await this.list(noteId, Number.MAX_SAFE_INTEGER);
    await this.acknowledge(noteId, rows.map((row) => row.updateId));
  }

  close() {
    void this.database.then((db) => db.close()).catch(() => {});
  }
}
