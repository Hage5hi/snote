import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { CapabilityOutbox } from "../capability-outbox";

describe("CapabilityOutbox", () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("snote-capability-sync-test");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it("is idempotent by authority + updateId and survives reopen", async () => {
    const first = new CapabilityOutbox("snote-capability-sync-test");
    const row = {
      noteId: "note-a",
      scope: "edit" as const,
      generation: 1,
      updateId: "a".repeat(64),
      payload: "AQID",
      encryptionVersion: 2,
      createdAt: 10,
    };
    await first.enqueue(row);
    await first.enqueue({ ...row, createdAt: 20 });
    first.close();

    const reopened = new CapabilityOutbox("snote-capability-sync-test");
    expect(await reopened.list("note-a", "edit", 1)).toEqual([row]);
    reopened.close();
  });

  it("deletes only server-acknowledged update IDs", async () => {
    const outbox = new CapabilityOutbox("snote-capability-sync-test");
    await outbox.enqueue({
      noteId: "note-a",
      scope: "edit",
      generation: 1,
      updateId: "a".repeat(64),
      payload: "AQ",
      encryptionVersion: 0,
      createdAt: 1,
    });
    await outbox.enqueue({
      noteId: "note-a",
      scope: "edit",
      generation: 1,
      updateId: "b".repeat(64),
      payload: "Ag",
      encryptionVersion: 0,
      createdAt: 2,
    });

    await outbox.acknowledge("note-a", "edit", 1, ["b".repeat(64)]);

    expect((await outbox.list("note-a", "edit", 1)).map((row) => row.updateId))
      .toEqual(["a".repeat(64)]);
    outbox.close();
  });

  it("keeps the same update ID isolated across capability generations", async () => {
    const outbox = new CapabilityOutbox("snote-capability-sync-test");
    const updateId = "a".repeat(64);
    await outbox.enqueue({
      noteId: "note-a",
      scope: "edit",
      generation: 1,
      updateId,
      payload: "AQ",
      encryptionVersion: 0,
      createdAt: 1,
    });
    await outbox.enqueue({
      noteId: "note-a",
      scope: "edit",
      generation: 2,
      updateId,
      payload: "AQ",
      encryptionVersion: 0,
      createdAt: 2,
    });

    expect(await outbox.list("note-a", "edit", 1)).toHaveLength(1);
    expect(await outbox.list("note-a", "edit", 2)).toHaveLength(1);
    outbox.close();
  });

  it("isolates notes sharing the same database", async () => {
    const outbox = new CapabilityOutbox("snote-capability-sync-test");
    for (const noteId of ["note-a", "note-b"]) {
      await outbox.enqueue({
        noteId,
        scope: "edit",
        generation: 1,
        updateId: noteId === "note-a" ? "a".repeat(64) : "b".repeat(64),
        payload: "AQ",
        encryptionVersion: 0,
        createdAt: 1,
      });
    }

    await outbox.acknowledge("note-a", "edit", 1, ["a".repeat(64)]);

    expect(await outbox.list("note-a", "edit", 1)).toEqual([]);
    expect(await outbox.list("note-b", "edit", 1)).toHaveLength(1);
    outbox.close();
  });
});
