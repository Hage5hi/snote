import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  listSnapshots,
  maybeSaveSnapshot,
  protectExistingSnapshots,
  unprotectExistingSnapshots,
  type SnapshotProtection,
} from "@/lib/snapshots";

const protection: SnapshotProtection = {
  encrypt: async (bytes) => Uint8Array.from(bytes, (byte) => byte ^ 0xa5),
  decrypt: async (bytes) => Uint8Array.from(bytes, (byte) => byte ^ 0xa5),
};

async function rawRows(slug: string): Promise<unknown[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("note-snapshots", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction("snapshots", "readonly")
        .objectStore("snapshots")
        .index("slug")
        .getAll(slug);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

describe("encrypted local snapshot history", () => {
  it("never stores note plaintext and decrypts only with the note key", async () => {
    const slug = `encrypted-${crypto.randomUUID()}`;
    const secret = "private recovery text that must not reach IndexedDB";

    await maybeSaveSnapshot(slug, secret, protection);

    const raw = JSON.stringify(await rawRows(slug));
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain(secret.slice(0, 20));
    await expect(listSnapshots(slug)).rejects.toThrow("snapshot key required");
    expect((await listSnapshots(slug, protection))[0].content).toBe(secret);
  });

  it("converts existing plaintext snapshots before an encryption transition completes", async () => {
    const slug = `transition-${crypto.randomUUID()}`;
    const secret = "legacy plaintext snapshot to protect before reload";
    await maybeSaveSnapshot(slug, secret);

    await protectExistingSnapshots(slug, protection);

    const raw = JSON.stringify(await rawRows(slug));
    expect(raw).not.toContain(secret);
    expect((await listSnapshots(slug, protection))[0].content).toBe(secret);
  });

  it("restores protected history before removing the key from an unlocked note", async () => {
    const slug = `unlock-${crypto.randomUUID()}`;
    const secret = "recovery history survives an explicit unlock";
    await maybeSaveSnapshot(slug, secret, protection);

    await unprotectExistingSnapshots(slug, protection);

    expect((await listSnapshots(slug))[0].content).toBe(secret);
  });
});
