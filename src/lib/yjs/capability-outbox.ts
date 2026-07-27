import type { PendingUpdate } from "@/lib/capability/client";
import type { CapabilityScope } from "@/lib/capability/url";

export type WritableCapabilityScope = Exclude<CapabilityScope, "view">;

export type OutboxUpdate = PendingUpdate & {
  noteId: string;
  scope: WritableCapabilityScope;
  generation: number;
  createdAt: number;
};

const DEFAULT_DB_NAME = "snote-capability-sync";
const STORE = "updates";
const DB_VERSION = 2;
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
      request.onupgradeneeded = (event) => {
        const db = request.result;
        // Version 1 rows did not record which capability authorized them.
        // They cannot be safely replayed after rotation or under a viewer, so
        // purge that ambiguous draft-era queue during the security upgrade.
        if (event.oldVersion < 2 && db.objectStoreNames.contains(STORE)) {
          db.deleteObjectStore(STORE);
        }
        if (db.objectStoreNames.contains(STORE)) return;
        const store = db.createObjectStore(STORE, {
          keyPath: ["noteId", "scope", "generation", "updateId"],
        });
        store.createIndex(
          "authority_created",
          ["noteId", "scope", "generation", "createdAt"],
          { unique: false },
        );
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
    const key: [string, WritableCapabilityScope, number, string] = [
      update.noteId,
      update.scope,
      update.generation,
      update.updateId,
    ];
    const existing = await requestResult(store.get(key));
    if (!existing) store.add(update);
    await done;
  }

  async list(
    noteId: string,
    scope: WritableCapabilityScope,
    generation: number,
    limit = 100,
  ): Promise<OutboxUpdate[]> {
    const db = await this.database;
    const transaction = db.transaction(STORE, "readonly");
    const done = transactionDone(transaction);
    const index = transaction.objectStore(STORE).index("authority_created");
    const range = IDBKeyRange.bound(
      [noteId, scope, generation, 0],
      [noteId, scope, generation, Number.MAX_SAFE_INTEGER],
    );
    const rows = await requestResult(index.getAll(range, Math.min(limit, MAX_GET_ALL_COUNT))) as OutboxUpdate[];
    await done;
    return rows.sort((a, b) => a.createdAt - b.createdAt || a.updateId.localeCompare(b.updateId));
  }

  async acknowledge(
    noteId: string,
    scope: WritableCapabilityScope,
    generation: number,
    updateIds: string[],
  ): Promise<void> {
    if (updateIds.length === 0) return;
    const allowed = new Set(
      (await this.list(noteId, scope, generation, Number.MAX_SAFE_INTEGER))
        .map((row) => row.updateId),
    );
    const db = await this.database;
    const transaction = db.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE);
    for (const updateId of new Set(updateIds)) {
      if (allowed.has(updateId)) store.delete([noteId, scope, generation, updateId]);
    }
    await done;
  }

  async clear(noteId: string, scope: WritableCapabilityScope, generation: number): Promise<void> {
    const rows = await this.list(noteId, scope, generation, Number.MAX_SAFE_INTEGER);
    await this.acknowledge(noteId, scope, generation, rows.map((row) => row.updateId));
  }

  close() {
    void this.database.then((db) => db.close()).catch(() => {});
  }
}
