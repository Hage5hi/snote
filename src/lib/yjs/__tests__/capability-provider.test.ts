import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CapabilityYjsProvider, type CapabilityRealtimeFactory } from "../capability-provider";
import { CapabilityOutbox } from "../capability-outbox";
import type { CapabilityApi, NoteSession } from "@/lib/capability/client";
import { decodeCapabilityPayload } from "@/lib/capability/encoding";

const TOKEN = "e".repeat(43);
const NOTE_ID = "00000000-0000-4000-8000-000000000001";

function baseSession(overrides: Partial<NoteSession> = {}): NoteSession {
  return {
    noteId: NOTE_ID,
    slug: "daily",
    scope: "edit",
    realtimeToken: "header.payload.signature",
    realtimeExpiresAt: "2099-01-01T00:00:00.000Z",
    realtimeTopic: `note:${NOTE_ID}`,
    generation: 1,
    syncStatus: "active",
    currentSequence: 0,
    payloadLimitBytes: 4_194_304,
    checkpointSequence: 0,
    checkpointVersion: null,
    checkpointPayload: null,
    checkpointEncryptionVersion: null,
    missingUpdates: [],
    encryption: { enabled: false, version: 0, salt: null, check: null, iterations: 600_000 },
    ...overrides,
  };
}

function realtimeHarness() {
  const handlers = new Map<string, (message: { payload: unknown }) => void | Promise<void>>();
  const send = vi.fn(async () => "ok");
  const channel = {
    on: vi.fn((_type: string, filter: { event?: string }, handler: (message: { payload: unknown }) => void) => {
      if (filter.event) handlers.set(filter.event, handler);
      return channel;
    }),
    subscribe: vi.fn(async (handler: (status: string) => void | Promise<void>) => {
      await handler("SUBSCRIBED");
      return channel;
    }),
    send,
    unsubscribe: vi.fn(async () => "ok"),
  };
  const dispose = vi.fn(async () => {});
  const factory: CapabilityRealtimeFactory = () => ({
    channel,
    setAuth: vi.fn(async () => {}),
    dispose,
  });
  return { handlers, send, dispose, factory };
}

function apiHarness(syncImpl?: CapabilityApi["sync"]) {
  return {
    createNote: vi.fn(),
    openSession: vi.fn(async () => baseSession()),
    sync: vi.fn(syncImpl ?? (async (_token, body) => ({
      acknowledgements: body.updates.map((update, index) => ({
        updateId: update.updateId,
        sequence: index + 1,
      })),
      session: baseSession({ currentSequence: body.updates.length }),
    }))),
    manage: vi.fn(),
  } as unknown as CapabilityApi;
}

function encode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

describe("CapabilityYjsProvider", () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("snote-capability-provider-test");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it("persists an edit before acknowledgement and deletes it only after ack", async () => {
    let resolveSync!: (value: Awaited<ReturnType<CapabilityApi["sync"]>>) => void;
    const syncPending = new Promise<Awaited<ReturnType<CapabilityApi["sync"]>>>((resolve) => {
      resolveSync = resolve;
    });
    const api = apiHarness(async () => syncPending);
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const realtime = realtimeHarness();
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      doc,
      { api, outbox, realtimeFactory: realtime.factory },
    );
    await provider.connect({ name: "Tester", color: "#123456" });

    doc.getText("content").insert(0, "typed before navigation");
    await provider.whenLocalUpdatesPersisted();

    expect(await outbox.list(NOTE_ID, "edit", 1)).toHaveLength(1);
    resolveSync({
      acknowledgements: [{
        updateId: (await outbox.list(NOTE_ID, "edit", 1))[0].updateId,
        sequence: 1,
      }],
      session: baseSession({ currentSequence: 1 }),
    });
    await provider.flushNow();
    expect(await outbox.list(NOTE_ID, "edit", 1)).toEqual([]);
    await provider.destroy();
  });

  it("keeps an unacknowledged edit across provider teardown and reopen", async () => {
    const api = apiHarness(async () => { throw new Error("offline"); });
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      doc,
      { api, outbox, realtimeFactory: realtimeHarness().factory },
    );
    await provider.connect({ name: "Tester", color: "#123456" });
    doc.getText("content").insert(0, "offline edit");
    await provider.destroy();

    const reopened = new CapabilityOutbox("snote-capability-provider-test");
    expect(await reopened.list(NOTE_ID, "edit", 1)).toHaveLength(1);
    reopened.close();
  });

  it("persists a peer update by hash before a failed origin-independent flush", async () => {
    const api = apiHarness(async () => { throw new Error("origin closed"); });
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const realtime = realtimeHarness();
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      doc,
      { api, outbox, realtimeFactory: realtime.factory },
    );
    await provider.connect({ name: "Tester", color: "#123456" });
    const remote = new Y.Doc();
    remote.getText("content").insert(0, "peer edit");
    const bytes = Y.encodeStateAsUpdate(remote);
    const payload = encode(bytes);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
    const updateId = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");

    await realtime.handlers.get("y-update")?.({
      payload: { updateId, payload, encryptionVersion: 0 },
    });
    await provider.whenLocalUpdatesPersisted();

    expect(doc.getText("content").toString()).toBe("peer edit");
    expect((await outbox.list(NOTE_ID, "edit", 1))[0].updateId).toBe(updateId);
    await provider.destroy();
  });

  it("applies view broadcasts without accumulating an outbox it cannot acknowledge", async () => {
    const api = apiHarness();
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const realtime = realtimeHarness();
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: null, scope: "view", token: TOKEN },
      baseSession({ scope: "view" }),
      doc,
      { api, outbox, realtimeFactory: realtime.factory },
    );
    await provider.connect({ name: "Viewer", color: "#123456" });
    const remote = new Y.Doc();
    remote.getText("content").insert(0, "visible update");
    const bytes = Y.encodeStateAsUpdate(remote);
    const digestInput = new Uint8Array(bytes.byteLength);
    digestInput.set(bytes);
    const updateId = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");

    await realtime.handlers.get("y-update")?.({
      payload: { updateId, payload: encode(bytes), encryptionVersion: 0 },
    });

    expect(doc.getText("content").toString()).toBe("visible update");
    expect(await outbox.list(NOTE_ID, "edit", 1)).toEqual([]);
    expect(api.sync).not.toHaveBeenCalled();
    await provider.destroy();
  });

  it("never exposes a prior editor outbox to a view capability", async () => {
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const source = new Y.Doc();
    source.getText("content").insert(0, "unpublished private edit");
    const bytes = Y.encodeStateAsUpdate(source);
    const updateId = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    await outbox.enqueue({
      noteId: NOTE_ID,
      scope: "edit",
      generation: 1,
      updateId,
      payload: encode(bytes),
      encryptionVersion: 0,
      createdAt: Date.now(),
    });
    const api = apiHarness();
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: null, scope: "view", token: TOKEN },
      baseSession({ scope: "view" }),
      doc,
      { api, outbox, realtimeFactory: realtimeHarness().factory },
    );

    await provider.connect({ name: "Viewer", color: "#123456" });

    expect(doc.getText("content").toString()).toBe("");
    expect(provider.getPendingBytes()).toBe(0);
    expect(api.sync).not.toHaveBeenCalled();
    await provider.destroy();
  });

  it("does not replay an outbox created by a revoked capability generation", async () => {
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const source = new Y.Doc();
    source.getText("content").insert(0, "revoked edit");
    const bytes = Y.encodeStateAsUpdate(source);
    const updateId = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    await outbox.enqueue({
      noteId: NOTE_ID,
      scope: "edit",
      generation: 1,
      updateId,
      payload: encode(bytes),
      encryptionVersion: 0,
      createdAt: Date.now(),
    });
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession({ generation: 2 } as Partial<NoteSession>),
      doc,
      {
        api: apiHarness(),
        outbox,
        realtimeFactory: realtimeHarness().factory,
      },
    );

    await provider.connect({ name: "Editor", color: "#123456" });

    expect(doc.getText("content").toString()).toBe("");
    expect(provider.getPendingBytes()).toBe(0);
    await provider.destroy();
  });

  it("durably saves a racing edit, then aborts the fenced encryption transition", async () => {
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const realtime = realtimeHarness();
    const api = apiHarness();
    api.sync = vi.fn(async (_token, body) => ({
      acknowledgements: body.updates.map((update, index) => ({
        updateId: update.updateId,
        sequence: index + 1,
      })),
      session: baseSession({ scope: "owner", currentSequence: body.updates.length }),
    }));
    api.openSession = vi.fn(async () => baseSession({ scope: "owner", currentSequence: 1 }));
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "owner", token: TOKEN },
      baseSession({ scope: "owner" }),
      doc,
      { api, outbox, realtimeFactory: realtime.factory },
    );
    const fenced: boolean[] = [];
    provider.onWriteFence((value) => fenced.push(value));
    await provider.connect({ name: "Owner", color: "#123456" });
    doc.getText("content").insert(0, "durable");
    await provider.whenLocalUpdatesPersisted();
    await provider.flushNow();

    const preparing = provider.prepareEncryptionTransition();
    expect(fenced.at(-1)).toBe(true);
    doc.getText("content").insert(doc.getText("content").length, " raced");

    await expect(preparing).rejects.toThrow("document changed during encryption transition");
    expect(realtime.dispose).toHaveBeenCalledOnce();
    expect(api.sync).toHaveBeenCalledTimes(2);
    expect(await outbox.list(NOTE_ID, "owner", 1)).toEqual([]);
    expect(() => provider.assertEncryptionTransitionStable())
      .toThrow("document changed during encryption transition");
    await provider.destroy();
  });

  it("merges server updates even when their delivery order is reversed", async () => {
    const source = new Y.Doc();
    const updates: Uint8Array[] = [];
    source.on("update", (update) => updates.push(update));
    source.getText("content").insert(0, "A");
    source.getText("content").insert(1, "B");
    const rows = await Promise.all(updates.map(async (bytes, index) => ({
      updateId: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), (byte) =>
        byte.toString(16).padStart(2, "0")).join(""),
      payload: encode(bytes),
      sequence: 2 - index,
      encryptionVersion: 0,
    })));
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession({ currentSequence: 2, missingUpdates: rows.reverse() }),
      doc,
      {
        api: apiHarness(),
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: realtimeHarness().factory,
      },
    );

    await provider.connect({ name: "Tester", color: "#123456" });

    expect(doc.getText("content").toString()).toBe("AB");
    await provider.destroy();
  });

  it("compacts acknowledged updates into a checkpoint with sequence and version CAS", async () => {
    const checkpointBodies: Array<Parameters<CapabilityApi["sync"]>[1]> = [];
    let call = 0;
    const api = apiHarness(async (_token, body) => {
      call += 1;
      if (body.checkpoint) checkpointBodies.push(body);
      if (call === 1) {
        return {
          acknowledgements: body.updates.map((update) => ({ updateId: update.updateId, sequence: 1 })),
          session: baseSession({ currentSequence: 1 }),
        };
      }
      return {
        acknowledgements: [],
        session: baseSession({
          currentSequence: 1,
          checkpointSequence: 1,
          checkpointVersion: 1,
          checkpointPayload: body.checkpoint?.payload ?? null,
          checkpointEncryptionVersion: 0,
        }),
      };
    });
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      doc,
      {
        api,
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: realtimeHarness().factory,
        compactionThresholdUpdates: 1,
      },
    );
    await provider.connect({ name: "Tester", color: "#123456" });

    doc.getText("content").insert(0, "durable checkpoint");
    await provider.whenLocalUpdatesPersisted();
    await provider.flushNow();

    expect(checkpointBodies).toHaveLength(1);
    expect(checkpointBodies[0].checkpoint).toMatchObject({
      throughSequence: 1,
      expectedCheckpointVersion: 0,
    });
    const restored = new Y.Doc();
    Y.applyUpdate(restored, decodeCapabilityPayload(checkpointBodies[0].checkpoint!.payload));
    expect(restored.getText("content").toString()).toBe("durable checkpoint");
    expect(provider.getSession().checkpointSequence).toBe(1);
    await provider.destroy();
  });

  it("refreshes checkpoint state after a concurrent compaction wins the CAS", async () => {
    let call = 0;
    const api = apiHarness(async (_token, body) => {
      call += 1;
      if (call === 1) {
        return {
          acknowledgements: body.updates.map((update) => ({ updateId: update.updateId, sequence: 1 })),
          session: baseSession({ currentSequence: 1 }),
        };
      }
      throw new Error("version conflict");
    });
    api.openSession = vi.fn(async () => baseSession({
      currentSequence: 1,
      checkpointSequence: 1,
      checkpointVersion: 1,
    }));
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      doc,
      {
        api,
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: realtimeHarness().factory,
        compactionThresholdUpdates: 1,
      },
    );
    await provider.connect({ name: "Tester", color: "#123456" });
    doc.getText("content").insert(0, "concurrent checkpoint");
    await provider.whenLocalUpdatesPersisted();

    await provider.flushNow();

    expect(api.openSession).toHaveBeenCalledWith(TOKEN, 1);
    expect(provider.getSession().checkpointVersion).toBe(1);
    await provider.destroy();
  });
});
