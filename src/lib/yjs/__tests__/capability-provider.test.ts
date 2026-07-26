import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  CapabilityYjsProvider,
  type CapabilityRealtimeFactory,
  type CapabilityRealtimeHandle,
} from "../capability-provider";
import { CapabilityOutbox } from "../capability-outbox";
import type {
  CapabilityApi,
  PollingNoteSession,
  PrivateRealtimeNoteSession,
} from "@/lib/capability/client";
import { decodeCapabilityPayload } from "@/lib/capability/encoding";

const TOKEN = "e".repeat(43);
const NOTE_ID = "00000000-0000-4000-8000-000000000001";
const root = process.cwd();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function providerSource() {
  return readFileSync(resolve(root, "src/lib/yjs/capability-provider.ts"), "utf8")
    .replace(/\r\n/g, "\n");
}

function baseSession(
  overrides: Partial<PrivateRealtimeNoteSession> = {},
): PrivateRealtimeNoteSession {
  return {
    noteId: NOTE_ID,
    slug: "daily",
    scope: "edit",
    syncTransport: "private-realtime",
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

function pollingSession(
  overrides: Partial<PollingNoteSession> = {},
): PollingNoteSession {
  const {
    syncTransport: _syncTransport,
    realtimeToken: _token,
    realtimeExpiresAt: _expiresAt,
    ...durable
  } = baseSession();
  return {
    ...durable,
    syncTransport: "polling",
    realtimeToken: null,
    realtimeExpiresAt: null,
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
  const factory: CapabilityRealtimeFactory = async () => ({
    channel,
    setAuth: vi.fn(async () => {}),
    dispose,
  });
  return { handlers, send, dispose, factory };
}

function lifecycleRealtimeHarness(events: string[]) {
  const handles: Array<{
    setAuth: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  const factory = vi.fn(async (session: PrivateRealtimeNoteSession) => {
    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(async (handler: (status: string) => void | Promise<void>) => {
        events.push("subscribe");
        await handler("SUBSCRIBED");
        return channel;
      }),
      send: vi.fn(async () => "ok"),
      unsubscribe: vi.fn(async () => "ok"),
    };
    const setAuth = vi.fn(async (token: string) => {
      events.push(`set-auth:${token}`);
    });
    const dispose = vi.fn(async () => {
      events.push(`dispose:${session.realtimeToken}`);
    });
    await setAuth(session.realtimeToken);
    handles.push({ setAuth, dispose });
    return { channel, setAuth, dispose };
  });
  return {
    factory: factory as CapabilityRealtimeFactory,
    handles,
    realtimeFactory: factory,
  };
}

function realtimeHandle(): CapabilityRealtimeHandle {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(async (handler: (status: string) => void | Promise<void>) => {
      await handler("SUBSCRIBED");
      return channel;
    }),
    send: vi.fn(async () => "ok"),
    unsubscribe: vi.fn(async () => "ok"),
  };
  return {
    channel,
    setAuth: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

function controllableRealtimeHarness() {
  const broadcastHandlers = new Map<string, (message: { payload: unknown }) => void | Promise<void>>();
  let statusHandler: ((status: string) => void | Promise<void>) | undefined;
  const channel = {
    on: vi.fn((_type: string, filter: { event?: string }, handler: (message: { payload: unknown }) => void) => {
      if (filter.event) broadcastHandlers.set(filter.event, handler);
      return channel;
    }),
    subscribe: vi.fn(async (handler: (status: string) => void | Promise<void>) => {
      statusHandler = handler;
      return channel;
    }),
    send: vi.fn(async () => "ok"),
    unsubscribe: vi.fn(async () => "ok"),
  };
  const dispose = vi.fn(async () => {});
  const factory: CapabilityRealtimeFactory = async () => ({
    channel,
    setAuth: vi.fn(async () => {}),
    dispose,
  });
  return {
    dispose,
    factory,
    emitStatus: async (status: string) => statusHandler?.(status),
    emitBroadcast: async (event: string, payload: unknown) => broadcastHandlers.get(event)?.({ payload }),
  };
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

  it("waits for managed platform auth before subscribing to an initial private channel", async () => {
    const events: string[] = [];
    const realtime = lifecycleRealtimeHarness(events);
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      new Y.Doc(),
      {
        api: apiHarness(),
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: realtime.factory,
      },
    );

    await provider.connect({ name: "Tester", color: "#123456" });

    expect(events).toEqual([
      "set-auth:header.payload.signature",
      "subscribe",
    ]);
    expect(realtime.handles[0].setAuth).toHaveBeenCalledExactlyOnceWith("header.payload.signature");
    await provider.destroy();
  });

  it("opens a fresh session before refreshing private channel auth with its returned token", async () => {
    const events: string[] = [];
    const realtime = lifecycleRealtimeHarness(events);
    const api = apiHarness();
    api.openSession = vi.fn(async () => {
      events.push("open-session");
      return baseSession({
        realtimeToken: "platform.jwt.new",
        realtimeExpiresAt: "2099-01-01T00:01:00.000Z",
      });
    });
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      new Y.Doc(),
      {
        api,
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: realtime.factory,
      },
    );
    await provider.connect({ name: "Tester", color: "#123456" });
    events.length = 0;

    await provider.refreshNow();

    expect(events).toEqual(["open-session", "set-auth:platform.jwt.new"]);
    expect(realtime.handles).toHaveLength(1);
    expect(realtime.handles[0].setAuth).toHaveBeenLastCalledWith("platform.jwt.new");
    await provider.destroy();
  });

  it("disposes private realtime and never sends a null token when a refreshed session falls back to polling", async () => {
    const events: string[] = [];
    const realtime = lifecycleRealtimeHarness(events);
    const api = apiHarness();
    api.openSession = vi.fn(async () => pollingSession());
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      new Y.Doc(),
      {
        api,
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: realtime.factory,
      },
    );
    await provider.connect({ name: "Tester", color: "#123456" });

    await provider.refreshNow();

    expect(realtime.handles[0].dispose).toHaveBeenCalledOnce();
    expect(realtime.realtimeFactory).not.toHaveBeenCalledWith(
      expect.objectContaining({ syncTransport: "polling" }),
    );
    expect(realtime.handles[0].setAuth).not.toHaveBeenCalledWith(null);
    await provider.destroy();
    expect(realtime.handles[0].dispose).toHaveBeenCalledOnce();
  });

  it("creates a private channel only after a polling session refresh returns managed realtime auth", async () => {
    const events: string[] = [];
    const realtime = lifecycleRealtimeHarness(events);
    const api = apiHarness();
    api.openSession = vi.fn(async () => {
      events.push("open-session");
      return baseSession({
        realtimeToken: "platform.jwt.new",
        realtimeExpiresAt: "2099-01-01T00:01:00.000Z",
      });
    });
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      pollingSession(),
      new Y.Doc(),
      {
        api,
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: realtime.factory,
      },
    );
    await provider.connect({ name: "Tester", color: "#123456" });

    expect(realtime.realtimeFactory).not.toHaveBeenCalled();
    await provider.refreshNow();

    expect(events).toEqual([
      "open-session",
      "set-auth:platform.jwt.new",
      "subscribe",
    ]);
    expect(realtime.realtimeFactory).not.toHaveBeenCalledWith(
      expect.objectContaining({ syncTransport: "polling" }),
    );
    await provider.destroy();
  });

  it("fences encryption while stopping the old transport and restarts only the final selected private transport", async () => {
    const events: string[] = [];
    const realtime = lifecycleRealtimeHarness(events);
    const api = apiHarness();
    api.openSession = vi.fn()
      .mockResolvedValueOnce(pollingSession({ scope: "owner" }))
      .mockResolvedValueOnce(baseSession({
        scope: "owner",
        realtimeToken: "platform.jwt.after-transition",
        realtimeExpiresAt: "2099-01-01T00:01:00.000Z",
      }));
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "owner", token: TOKEN },
      baseSession({ scope: "owner" }),
      new Y.Doc(),
      {
        api,
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: realtime.factory,
      },
    );
    await provider.connect({ name: "Owner", color: "#123456" });
    events.length = 0;

    const session = await provider.prepareEncryptionTransition();

    expect(session).toMatchObject({ syncTransport: "private-realtime", realtimeToken: "platform.jwt.after-transition" });
    expect(realtime.handles[0].dispose).toHaveBeenCalledOnce();
    expect(realtime.realtimeFactory).toHaveBeenCalledTimes(2);
    expect(realtime.realtimeFactory).not.toHaveBeenCalledWith(
      expect.objectContaining({ syncTransport: "polling" }),
    );
    expect(events).toEqual([
      "dispose:header.payload.signature",
      "set-auth:platform.jwt.after-transition",
      "subscribe",
    ]);
    await provider.destroy();
    expect(realtime.handles[1].dispose).toHaveBeenCalledOnce();
  });

  it("disposes an active private transport exactly once when destroyed repeatedly", async () => {
    const events: string[] = [];
    const realtime = lifecycleRealtimeHarness(events);
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      new Y.Doc(),
      {
        api: apiHarness(),
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: realtime.factory,
      },
    );
    await provider.connect({ name: "Tester", color: "#123456" });

    await provider.destroy();
    await provider.destroy();

    expect(realtime.handles[0].dispose).toHaveBeenCalledOnce();
  });

  it("sets managed Auth before the default factory creates its private channel", () => {
    const implementation = providerSource();
    const auth = implementation.indexOf("await client.realtime.setAuth(session.realtimeToken)");
    const channel = implementation.indexOf("const channel = client.channel(session.realtimeTopic");

    expect(auth).toBeGreaterThan(-1);
    expect(channel).toBeGreaterThan(auth);
    expect(implementation).not.toContain("accessToken: async");
  });

  it("disposes private Realtime when a sync response falls back to polling", async () => {
    const events: string[] = [];
    const realtime = lifecycleRealtimeHarness(events);
    const pendingSync = deferred<Awaited<ReturnType<CapabilityApi["sync"]>>>();
    const api = apiHarness(async () => pendingSync.promise);
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      doc,
      { api, outbox, realtimeFactory: realtime.factory },
    );
    await provider.connect({ name: "Tester", color: "#123456" });
    events.length = 0;

    doc.getText("content").insert(0, "sync fallback");
    await provider.whenLocalUpdatesPersisted();
    const [pending] = await outbox.list(NOTE_ID, "edit", 1);
    pendingSync.resolve({
      acknowledgements: [{ updateId: pending.updateId, sequence: 1 }],
      session: pollingSession({ currentSequence: 1 }),
    });
    await provider.flushNow();
    const disposeCallsBeforeDestroy = realtime.handles[0].dispose.mock.calls.length;
    await provider.destroy();

    expect(disposeCallsBeforeDestroy).toBe(1);
    expect(realtime.realtimeFactory).not.toHaveBeenCalledWith(
      expect.objectContaining({ syncTransport: "polling" }),
    );
  });

  it("creates private Realtime when a polling sync response receives managed Auth", async () => {
    const events: string[] = [];
    const realtime = lifecycleRealtimeHarness(events);
    const pendingSync = deferred<Awaited<ReturnType<CapabilityApi["sync"]>>>();
    const api = apiHarness(async () => pendingSync.promise);
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      pollingSession(),
      doc,
      { api, outbox, realtimeFactory: realtime.factory },
    );
    await provider.connect({ name: "Tester", color: "#123456" });

    doc.getText("content").insert(0, "sync upgrade");
    await provider.whenLocalUpdatesPersisted();
    const [pending] = await outbox.list(NOTE_ID, "edit", 1);
    pendingSync.resolve({
      acknowledgements: [{ updateId: pending.updateId, sequence: 1 }],
      session: baseSession({
        currentSequence: 1,
        realtimeToken: "platform.jwt.from-sync",
        realtimeExpiresAt: "2099-01-01T00:01:00.000Z",
      }),
    });
    await provider.flushNow();
    const eventsBeforeDestroy = [...events];
    const factoryCallsBeforeDestroy = realtime.realtimeFactory.mock.calls.length;
    await provider.destroy();

    expect(eventsBeforeDestroy).toEqual([
      "set-auth:platform.jwt.from-sync",
      "subscribe",
    ]);
    expect(factoryCallsBeforeDestroy).toBe(1);
  });

  it("refreshes active private Realtime with the token returned by sync", async () => {
    const events: string[] = [];
    const realtime = lifecycleRealtimeHarness(events);
    const pendingSync = deferred<Awaited<ReturnType<CapabilityApi["sync"]>>>();
    const api = apiHarness(async () => pendingSync.promise);
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      doc,
      { api, outbox, realtimeFactory: realtime.factory },
    );
    await provider.connect({ name: "Tester", color: "#123456" });
    events.length = 0;

    doc.getText("content").insert(0, "sync token refresh");
    await provider.whenLocalUpdatesPersisted();
    const [pending] = await outbox.list(NOTE_ID, "edit", 1);
    pendingSync.resolve({
      acknowledgements: [{ updateId: pending.updateId, sequence: 1 }],
      session: baseSession({
        currentSequence: 1,
        realtimeToken: "platform.jwt.from-sync",
        realtimeExpiresAt: "2099-01-01T00:01:00.000Z",
      }),
    });
    await provider.flushNow();
    const eventsBeforeDestroy = [...events];
    const handlesBeforeDestroy = realtime.handles.length;
    await provider.destroy();

    expect(eventsBeforeDestroy).toEqual(["set-auth:platform.jwt.from-sync"]);
    expect(handlesBeforeDestroy).toBe(1);
  });

  it("does not restart Realtime from an in-flight refresh during an encryption fence", async () => {
    const events: string[] = [];
    const realtime = lifecycleRealtimeHarness(events);
    const refreshSession = deferred<PrivateRealtimeNoteSession>();
    const firstTransitionSession = deferred<PollingNoteSession>();
    let enteredFirstTransition!: () => void;
    const firstTransitionEntered = new Promise<void>((resolve) => {
      enteredFirstTransition = resolve;
    });
    const api = apiHarness();
    api.openSession = vi.fn()
      .mockImplementationOnce(() => refreshSession.promise)
      .mockImplementationOnce(() => {
        enteredFirstTransition();
        return firstTransitionSession.promise;
      })
      .mockResolvedValueOnce(baseSession({
        scope: "owner",
        realtimeToken: "platform.jwt.after-fence",
        realtimeExpiresAt: "2099-01-01T00:01:00.000Z",
      }));
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "owner", token: TOKEN },
      baseSession({ scope: "owner" }),
      new Y.Doc(),
      {
        api,
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: realtime.factory,
      },
    );
    await provider.connect({ name: "Owner", color: "#123456" });
    events.length = 0;

    const refresh = provider.refreshNow();
    expect(api.openSession).toHaveBeenCalledOnce();
    const transition = provider.prepareEncryptionTransition();
    await vi.waitFor(() => expect(realtime.handles[0].dispose).toHaveBeenCalledOnce());
    // The transition waits behind an in-flight refresh rather than issuing an
    // out-of-order durable read. Its write fence still detaches the channel
    // before that refresh is allowed to finish.
    expect(api.openSession).toHaveBeenCalledOnce();

    refreshSession.resolve(baseSession({
      scope: "owner",
      realtimeToken: "platform.jwt.racing-refresh",
      realtimeExpiresAt: "2099-01-01T00:01:00.000Z",
    }));
    await refresh;
    await firstTransitionEntered;
    const handlesDuringFence = realtime.handles.length;
    const eventsDuringFence = [...events];

    firstTransitionSession.resolve(pollingSession({ scope: "owner" }));
    const session = await transition;
    const handlesAfterTransition = realtime.handles.length;
    const eventsAfterTransition = [...events];
    await provider.destroy();

    expect(handlesDuringFence).toBe(1);
    expect(eventsDuringFence).toEqual(["dispose:header.payload.signature"]);
    expect(session).toMatchObject({
      syncTransport: "private-realtime",
      realtimeToken: "platform.jwt.after-fence",
    });
    expect(handlesAfterTransition).toBe(2);
    expect(eventsAfterTransition).toEqual([
      "dispose:header.payload.signature",
      "set-auth:platform.jwt.after-fence",
      "subscribe",
    ]);
  });

  it("serializes a refresh behind an in-flight sync session reconciliation", async () => {
    const syncResponse = deferred<Awaited<ReturnType<CapabilityApi["sync"]>>>();
    const firstRealtime = deferred<CapabilityRealtimeHandle>();
    let enteredSync!: () => void;
    let startedRealtime!: () => void;
    const syncEntered = new Promise<void>((resolve) => { enteredSync = resolve; });
    const realtimeStarted = new Promise<void>((resolve) => { startedRealtime = resolve; });
    const api = apiHarness();
    api.sync = vi.fn(async () => {
      enteredSync();
      return syncResponse.promise;
    });
    const openSession = vi.fn(async () => baseSession({
      currentSequence: 1,
      realtimeToken: "platform.jwt.concurrent",
      realtimeExpiresAt: "2099-01-01T00:01:00.000Z",
    }));
    api.openSession = openSession;
    const factory = vi.fn(async () => {
      startedRealtime();
      return firstRealtime.promise;
    });
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      pollingSession(),
      doc,
      { api, outbox, realtimeFactory: factory as CapabilityRealtimeFactory },
    );
    await provider.connect({ name: "Tester", color: "#123456" });

    doc.getText("content").insert(0, "sync and refresh race");
    await provider.whenLocalUpdatesPersisted();
    const [pending] = await outbox.list(NOTE_ID, "edit", 1);
    const syncing = provider.flushNow();
    await syncEntered;
    syncResponse.resolve({
      acknowledgements: [{ updateId: pending.updateId, sequence: 1 }],
      session: baseSession({
        currentSequence: 1,
        realtimeToken: "platform.jwt.concurrent",
        realtimeExpiresAt: "2099-01-01T00:01:00.000Z",
      }),
    });
    await realtimeStarted;

    const refreshing = provider.refreshNow();
    const openCallsWhileSyncReconciles = openSession.mock.calls.length;
    firstRealtime.resolve(realtimeHandle());
    await Promise.all([syncing, refreshing]);
    const factoryCalls = factory.mock.calls.length;
    await provider.destroy();

    expect(openCallsWhileSyncReconciles).toBe(0);
    expect(factoryCalls).toBe(1);
  });

  it("disposes a superseded same-token private Realtime factory result", async () => {
    const firstFactoryResult = deferred<CapabilityRealtimeHandle>();
    const secondFactoryResult = deferred<CapabilityRealtimeHandle>();
    const firstHandle = realtimeHandle();
    const secondHandle = realtimeHandle();
    const factory = vi.fn()
      .mockImplementationOnce(() => firstFactoryResult.promise)
      .mockImplementationOnce(() => secondFactoryResult.promise);
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      new Y.Doc(),
      {
        api: apiHarness(),
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: factory as CapabilityRealtimeFactory,
      },
    );

    const firstConnect = provider.connect({ name: "Tester", color: "#123456" });
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    const secondConnect = provider.connect({ name: "Tester", color: "#123456" });
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    firstFactoryResult.resolve(firstHandle);
    await vi.waitFor(() => expect(firstHandle.dispose).toHaveBeenCalledOnce());
    secondFactoryResult.resolve(secondHandle);
    await Promise.all([firstConnect, secondConnect]);
    await provider.destroy();

    expect(firstHandle.dispose).toHaveBeenCalledOnce();
    expect(secondHandle.dispose).toHaveBeenCalledOnce();
  });

  it("ignores callbacks emitted by a disposed private channel", async () => {
    const realtime = controllableRealtimeHarness();
    const api = apiHarness(async () => { throw new Error("offline"); });
    api.openSession = vi.fn(async () => pollingSession());
    const outbox = new CapabilityOutbox("snote-capability-provider-test");
    const doc = new Y.Doc();
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "edit", token: TOKEN },
      baseSession(),
      doc,
      { api, outbox, realtimeFactory: realtime.factory },
    );
    await provider.connect({ name: "Tester", color: "#123456" });
    await realtime.emitStatus("SUBSCRIBED");
    await provider.refreshNow();
    expect(api.openSession).toHaveBeenCalledOnce();
    expect(provider.getSession().syncTransport).toBe("polling");
    expect(realtime.dispose).toHaveBeenCalledOnce();

    const remote = new Y.Doc();
    remote.getText("content").insert(0, "late update");
    const bytes = Y.encodeStateAsUpdate(remote);
    const updateId = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    await realtime.emitStatus("SUBSCRIBED");
    await realtime.emitBroadcast("y-update", {
      updateId,
      payload: encode(bytes),
      encryptionVersion: 0,
    });
    await provider.whenLocalUpdatesPersisted();
    const connectedAfterLateCallback = provider.connected;
    const contentAfterLateCallback = doc.getText("content").toString();
    await provider.destroy();

    expect(realtime.dispose).toHaveBeenCalledOnce();
    expect(connectedAfterLateCallback).toBe(false);
    expect(contentAfterLateCallback).toBe("");
  });

  it("does not apply a peer update that was suspended when encryption fenced the transport", async () => {
    const realtime = controllableRealtimeHarness();
    const decryptGate = deferred<Uint8Array>();
    let decryptStarted!: () => void;
    const decrypting = new Promise<void>((resolve) => { decryptStarted = resolve; });
    const encryptionMetadata = {
      enabled: true,
      version: 1,
      salt: "salt",
      check: "check",
      iterations: 600_000,
    } as const;
    const encryptedOwnerSession = (overrides: Partial<PrivateRealtimeNoteSession> = {}) => baseSession({
      scope: "owner",
      encryption: encryptionMetadata,
      ...overrides,
    });
    const encryption = {
      encrypt: vi.fn(async (bytes: Uint8Array) => bytes),
      decrypt: vi.fn(async () => {
        decryptStarted();
        return decryptGate.promise;
      }),
    };
    const api = apiHarness(async (_token, body) => ({
      acknowledgements: body.updates.map((update, index) => ({
        updateId: update.updateId,
        sequence: index + 1,
      })),
      session: encryptedOwnerSession({ currentSequence: body.updates.length }),
    }));
    api.openSession = vi.fn(async () => encryptedOwnerSession({ currentSequence: 1 }));
    const provider = new CapabilityYjsProvider(
      { slug: "daily", scope: "owner", token: TOKEN },
      encryptedOwnerSession(),
      new Y.Doc(),
      {
        api,
        outbox: new CapabilityOutbox("snote-capability-provider-test"),
        realtimeFactory: realtime.factory,
      },
      encryption,
    );
    await provider.connect({ name: "Owner", color: "#123456" });

    const peer = new Y.Doc();
    peer.getText("content").insert(0, "late encrypted peer update");
    const plaintext = Y.encodeStateAsUpdate(peer);
    const ciphertext = new Uint8Array([1, 2, 3]);
    const updateId = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const inbound = realtime.emitBroadcast("y-update", {
      updateId,
      payload: encode(ciphertext),
      encryptionVersion: 1,
    });
    await decrypting;

    await provider.prepareEncryptionTransition();
    decryptGate.resolve(plaintext);
    await inbound;
    const contentAfterFence = provider.doc.getText("content").toString();
    await provider.destroy();

    expect(contentAfterFence).toBe("");
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
      baseSession({ generation: 2 }),
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
    const realtime = lifecycleRealtimeHarness([]);
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
        session: pollingSession({
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
        realtimeFactory: realtime.factory,
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
    expect(realtime.handles[0].dispose).toHaveBeenCalledOnce();
    await provider.destroy();
  });

  it("refreshes checkpoint state after a concurrent compaction wins the CAS", async () => {
    const realtime = lifecycleRealtimeHarness([]);
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
    api.openSession = vi.fn(async () => pollingSession({
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
        realtimeFactory: realtime.factory,
        compactionThresholdUpdates: 1,
      },
    );
    await provider.connect({ name: "Tester", color: "#123456" });
    doc.getText("content").insert(0, "concurrent checkpoint");
    await provider.whenLocalUpdatesPersisted();

    await provider.flushNow();

    expect(api.openSession).toHaveBeenCalledWith(TOKEN, 1);
    expect(provider.getSession().checkpointVersion).toBe(1);
    expect(realtime.handles[0].dispose).toHaveBeenCalledOnce();
    await provider.destroy();
  });
});
