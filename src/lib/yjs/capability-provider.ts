import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { createClient } from "@supabase/supabase-js";
import type { CapabilityAccess } from "@/lib/capability/url";
import {
  createCapabilityApi,
  type CapabilityApi,
  type NoteSession,
  type PendingUpdate,
} from "@/lib/capability/client";
import { CapabilityOutbox, type OutboxUpdate } from "./capability-outbox";
import type { AwarenessState, Encryption, SyncEvent, YjsProviderLike } from "./provider";
import {
  capabilityPayloadId,
  decodeCapabilityPayload,
  encodeCapabilityPayload,
} from "@/lib/capability/encoding";

type Listener<T> = (value: T) => void;

type RealtimeChannelLike = {
  on: (
    type: string,
    filter: { event?: string },
    handler: (message: { payload: unknown }) => void | Promise<void>,
  ) => RealtimeChannelLike;
  subscribe: (handler: (status: string) => void | Promise<void>) => unknown;
  send: (message: { type: string; event: string; payload: unknown }) => unknown;
  unsubscribe: () => unknown;
};

export type CapabilityRealtimeHandle = {
  channel: RealtimeChannelLike;
  setAuth: (token: string) => void | Promise<void>;
  dispose: () => void | Promise<void>;
};

export type CapabilityRealtimeFactory = (session: NoteSession) => CapabilityRealtimeHandle;

type ProviderDependencies = {
  api?: CapabilityApi;
  outbox?: CapabilityOutbox;
  realtimeFactory?: CapabilityRealtimeFactory;
  now?: () => number;
  compactionThresholdUpdates?: number;
};

const MAX_REALTIME_UPDATE_BYTES = 180 * 1024;
const MAX_AWARENESS_BYTES = 32 * 1024;
const MAX_KEEPALIVE_BATCH_BYTES = 48 * 1024;
const DEFAULT_COMPACTION_THRESHOLD_UPDATES = 200;

function isBroadcastUpdate(value: unknown): value is PendingUpdate {
  if (!value || typeof value !== "object") return false;
  const update = value as Partial<PendingUpdate>;
  return typeof update.updateId === "string"
    && /^[a-f0-9]{64}$/.test(update.updateId)
    && typeof update.payload === "string"
    && Number.isSafeInteger(update.encryptionVersion);
}

function defaultRealtimeFactory(session: NoteSession): CapabilityRealtimeHandle {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  if (!url || !key) throw new Error("Realtime unavailable");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => session.realtimeToken,
  });
  void client.realtime.setAuth(session.realtimeToken);
  const channel = client.channel(session.realtimeTopic, {
    config: {
      private: true,
      broadcast: { self: false, ack: true },
    },
  }) as unknown as RealtimeChannelLike;
  return {
    channel,
    setAuth: (token) => client.realtime.setAuth(token),
    dispose: async () => {
      await channel.unsubscribe();
      client.removeChannel(channel as never);
    },
  };
}

export class CapabilityYjsProvider implements YjsProviderLike {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  slug: string;
  connected = false;

  private session: NoteSession;
  private encryption: Encryption | null;
  private readonly api: CapabilityApi;
  private readonly outbox: CapabilityOutbox;
  private readonly realtimeFactory: CapabilityRealtimeFactory;
  private readonly now: () => number;
  private readonly compactionThresholdUpdates: number;
  private realtime: CapabilityRealtimeHandle | null = null;
  private syncListeners = new Set<Listener<SyncEvent>>();
  private awarenessListeners = new Set<Listener<Map<number, AwarenessState>>>();
  private pendingPersistence: Promise<void> = Promise.resolve();
  private flushPromise: Promise<void> | null = null;
  private compactionPromise: Promise<void> | null = null;
  private pendingBytes = 0;
  private lastBroadcastAt = 0;
  private lastSnapshotAt = 0;
  private closing = false;
  private destroyed = false;
  private refreshTimer: number | null = null;

  constructor(
    readonly access: CapabilityAccess,
    session: NoteSession,
    doc: Y.Doc,
    dependencies: ProviderDependencies = {},
    encryption?: Encryption | null,
  ) {
    if (access.scope !== session.scope) throw new Error("capability scope changed");
    if (access.slug !== null && access.slug !== session.slug) throw new Error("capability locator mismatch");
    this.slug = session.slug;
    this.session = session;
    this.doc = doc;
    this.encryption = encryption ?? null;
    this.api = dependencies.api ?? createCapabilityApi();
    this.outbox = dependencies.outbox ?? new CapabilityOutbox();
    this.realtimeFactory = dependencies.realtimeFactory ?? defaultRealtimeFactory;
    this.now = dependencies.now ?? Date.now;
    this.compactionThresholdUpdates = Math.max(
      1,
      Math.floor(dependencies.compactionThresholdUpdates ?? DEFAULT_COMPACTION_THRESHOLD_UPDATES),
    );
    this.awareness = new Awareness(doc);
  }

  setEncryption(encryption: Encryption | null) {
    this.encryption = encryption;
  }

  setExpectedEncrypted(expected: boolean | null) {
    if (expected !== null && expected !== this.session.encryption.enabled) {
      this.emitSync({ type: "error", message: "encryption mode changed" });
    }
  }

  getSession() {
    return this.session;
  }

  getPendingBytes() { return this.pendingBytes; }
  getLastBroadcastAt() { return this.lastBroadcastAt; }
  getLastSnapshotAt() { return this.lastSnapshotAt; }
  hasUnflushedLocalChanges() { return this.pendingBytes > 0; }

  onSyncEvent(listener: Listener<SyncEvent>) {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  onAwareness(listener: Listener<Map<number, AwarenessState>>) {
    this.awarenessListeners.add(listener);
    listener(this.awareness.getStates() as Map<number, AwarenessState>);
    return () => this.awarenessListeners.delete(listener);
  }

  private emitSync(event: SyncEvent) {
    for (const listener of this.syncListeners) {
      try { listener(event); } catch { /* isolate UI listeners */ }
    }
  }

  private trackPersistence(work: () => Promise<void>) {
    this.pendingPersistence = this.pendingPersistence.then(work, work);
    return this.pendingPersistence;
  }

  async whenLocalUpdatesPersisted() {
    await this.pendingPersistence;
  }

  private async decodeStoredUpdate(update: PendingUpdate): Promise<Uint8Array> {
    const stored = decodeCapabilityPayload(update.payload);
    if (stored.byteLength === 0 || stored.byteLength > this.session.payloadLimitBytes) {
      throw new Error("update payload outside audited limit");
    }
    if (await capabilityPayloadId(stored) !== update.updateId) throw new Error("update hash mismatch");
    if (update.encryptionVersion !== this.session.encryption.version) {
      throw new Error("update encryption version mismatch");
    }
    if (!this.session.encryption.enabled) return stored;
    if (!this.encryption) throw new Error("encrypted note is locked");
    return this.encryption.decrypt(stored);
  }

  private async applyDurableSession(next: NoteSession) {
    if (next.noteId !== this.session.noteId || next.scope !== this.access.scope) {
      throw new Error("note session changed");
    }
    this.session = next;
    if (next.checkpointPayload) {
      const checkpoint = {
        updateId: await capabilityPayloadId(decodeCapabilityPayload(next.checkpointPayload)),
        payload: next.checkpointPayload,
        encryptionVersion: next.checkpointEncryptionVersion ?? next.encryption.version,
      };
      const bytes = await this.decodeStoredUpdate(checkpoint);
      Y.applyUpdate(this.doc, bytes, "capability-session");
    }
    const ordered = [...next.missingUpdates].sort((a, b) => a.sequence - b.sequence);
    for (const update of ordered) {
      const bytes = await this.decodeStoredUpdate(update);
      Y.applyUpdate(this.doc, bytes, "capability-session");
    }
  }

  private async applyPendingOutbox() {
    const pending = await this.outbox.list(this.session.noteId, Number.MAX_SAFE_INTEGER);
    this.pendingBytes = pending.reduce((sum, row) => sum + decodeCapabilityPayload(row.payload).byteLength, 0);
    for (const update of pending) {
      const bytes = await this.decodeStoredUpdate(update);
      Y.applyUpdate(this.doc, bytes, "capability-outbox");
    }
  }

  async connect(identity: { name: string; color: string }) {
    if (this.destroyed || this.closing) return;
    await this.applyDurableSession(this.session);
    await this.applyPendingOutbox();
    this.awareness.setLocalState({ user: identity });
    if (this.access.scope !== "view") this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);

    this.realtime = this.realtimeFactory(this.session);
    const channel = this.realtime.channel;
    channel.on("broadcast", { event: "y-update" }, async ({ payload }) => {
      if (!isBroadcastUpdate(payload) || this.destroyed || this.closing) return;
      try {
        const stored = decodeCapabilityPayload(payload.payload);
        const canonical: OutboxUpdate = {
          noteId: this.session.noteId,
          updateId: payload.updateId,
          payload: encodeCapabilityPayload(stored),
          encryptionVersion: payload.encryptionVersion,
          createdAt: this.now(),
        };
        if (this.access.scope === "view") {
          const bytes = await this.decodeStoredUpdate(canonical);
          Y.applyUpdate(this.doc, bytes, "capability-remote");
          return;
        }
        await this.trackPersistence(async () => {
          await this.outbox.enqueue(canonical);
          this.pendingBytes += stored.byteLength;
        });
        const bytes = await this.decodeStoredUpdate(canonical);
        Y.applyUpdate(this.doc, bytes, "capability-remote");
        void this.flushNow();
      } catch {
        this.emitSync({ type: "error", message: "invalid peer update" });
      }
    });
    channel.on("broadcast", { event: "awareness" }, ({ payload }) => {
      try {
        if (!payload || typeof payload !== "object") return;
        const encoded = (payload as { update?: unknown }).update;
        if (typeof encoded !== "string") return;
        const bytes = decodeCapabilityPayload(encoded);
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_AWARENESS_BYTES) return;
        applyAwarenessUpdate(this.awareness, bytes, "capability-remote");
      } catch { /* discard malformed awareness */ }
    });
    channel.subscribe(async (status) => {
      if (this.destroyed || this.closing) return;
      if (status === "SUBSCRIBED") {
        const wasOffline = !this.connected;
        this.connected = true;
        if (wasOffline) this.emitSync({ type: "online" });
        this.broadcastAwareness();
        void this.flushNow();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        if (this.connected) this.emitSync({ type: "offline" });
        this.connected = false;
      }
    });
    this.scheduleTokenRefresh();
    void this.flushNow();
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (
      this.destroyed
      || this.closing
      || this.access.scope === "view"
      || origin === "capability-session"
      || origin === "capability-remote"
      || origin === "capability-outbox"
    ) return;
    void this.trackPersistence(async () => {
      let stored = update;
      if (this.session.encryption.enabled) {
        if (!this.encryption) throw new Error("encrypted note is locked");
        stored = await this.encryption.encrypt(update);
      }
      if (stored.byteLength === 0 || stored.byteLength > this.session.payloadLimitBytes) {
        throw new Error("update payload outside audited limit");
      }
      const pending: OutboxUpdate = {
        noteId: this.session.noteId,
        updateId: await capabilityPayloadId(stored),
        payload: encodeCapabilityPayload(stored),
        encryptionVersion: this.session.encryption.version,
        createdAt: this.now(),
      };
      await this.outbox.enqueue(pending);
      this.pendingBytes += stored.byteLength;
      this.broadcastStoredUpdate(pending);
    }).then(() => this.flushNow()).catch((error) => {
      this.emitSync({ type: "error", message: error instanceof Error ? error.message : String(error) });
    });
  };

  private broadcastStoredUpdate(update: PendingUpdate) {
    if (!this.connected || !this.realtime || decodeCapabilityPayload(update.payload).byteLength > MAX_REALTIME_UPDATE_BYTES) return;
    void this.realtime.channel.send({
      type: "broadcast",
      event: "y-update",
      payload: update,
    });
    this.lastBroadcastAt = this.now();
  }

  private handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const states = this.awareness.getStates() as Map<number, AwarenessState>;
    this.awarenessListeners.forEach((listener) => listener(states));
    if (origin === "capability-remote") return;
    this.broadcastAwareness([...changes.added, ...changes.updated, ...changes.removed]);
  };

  private broadcastAwareness(clients?: number[]) {
    if (!this.connected || !this.realtime) return;
    const bytes = encodeAwarenessUpdate(
      this.awareness,
      clients ?? Array.from(this.awareness.getStates().keys()),
    );
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AWARENESS_BYTES) return;
    void this.realtime.channel.send({
      type: "broadcast",
      event: "awareness",
      payload: { update: encodeCapabilityPayload(bytes) },
    });
  }

  private compactIfNeeded(): Promise<void> {
    if (
      this.destroyed
      || this.closing
      || this.access.scope === "view"
      || this.session.currentSequence - this.session.checkpointSequence < this.compactionThresholdUpdates
    ) return Promise.resolve();
    if (this.compactionPromise) return this.compactionPromise;

    this.compactionPromise = (async () => {
      const throughSequence = this.session.currentSequence;
      const expectedCheckpointVersion = this.session.checkpointVersion ?? 0;
      const expectedEncryptionVersion = this.session.encryption.version;
      let stored = Y.encodeStateAsUpdate(this.doc);
      if (this.session.encryption.enabled) {
        if (!this.encryption) throw new Error("encrypted note is locked");
        stored = await this.encryption.encrypt(stored);
      }
      if (stored.byteLength === 0 || stored.byteLength > this.session.payloadLimitBytes) {
        throw new Error("checkpoint payload outside audited limit");
      }
      const response = await this.api.sync(this.access.token, {
        updates: [],
        expectedEncryptionVersion,
        afterSequence: throughSequence,
        checkpoint: {
          checkpointId: await capabilityPayloadId(stored),
          payload: encodeCapabilityPayload(stored),
          throughSequence,
          expectedCheckpointVersion,
        },
      });
      await this.applyDurableSession(response.session);
      if (this.session.checkpointSequence < throughSequence) {
        throw new Error("server did not advance checkpoint");
      }
    })().catch(async (error) => {
      // Another writer can legitimately win checkpoint CAS. Refresh the
      // checkpoint cursor without re-entering flushNow so future compactions
      // use the winning version instead of retrying stale state forever.
      try {
        const next = await this.api.openSession(this.access.token, this.session.currentSequence);
        await this.applyDurableSession(next);
        await this.realtime?.setAuth(next.realtimeToken);
        this.scheduleTokenRefresh();
      } catch {
        // The durable update acknowledgement already succeeded. A later
        // reconnect will retry this metadata refresh.
      }
      this.emitSync({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      this.compactionPromise = null;
    });
    return this.compactionPromise;
  }

  flushNow(keepalive = false): Promise<void> {
    if (this.destroyed || this.access.scope === "view") return Promise.resolve();
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = (async () => {
      await this.pendingPersistence;
      while (!this.destroyed) {
        const rows = await this.outbox.list(this.session.noteId, 100);
        if (rows.length === 0) {
          this.pendingBytes = 0;
          if (!keepalive) await this.compactIfNeeded();
          return;
        }
        const selected: OutboxUpdate[] = [];
        let bytes = 0;
        for (const row of rows) {
          const size = decodeCapabilityPayload(row.payload).byteLength;
          if (keepalive && selected.length > 0 && bytes + size > MAX_KEEPALIVE_BATCH_BYTES) break;
          selected.push(row);
          bytes += size;
        }
        try {
          const response = await this.api.sync(this.access.token, {
            updates: selected.map(({ updateId, payload, encryptionVersion }) => ({
              updateId,
              payload,
              encryptionVersion,
            })),
            expectedEncryptionVersion: this.session.encryption.version,
            afterSequence: this.session.currentSequence,
          }, keepalive);
          await this.applyDurableSession(response.session);
          const acknowledged = new Set(response.acknowledgements.map((item) => item.updateId));
          const expected = selected.map((item) => item.updateId).filter((id) => acknowledged.has(id));
          if (expected.length === 0) throw new Error("server did not acknowledge update batch");
          await this.outbox.acknowledge(this.session.noteId, expected);
          const remaining = await this.outbox.list(this.session.noteId, Number.MAX_SAFE_INTEGER);
          this.pendingBytes = remaining.reduce((sum, row) => sum + decodeCapabilityPayload(row.payload).byteLength, 0);
          this.lastSnapshotAt = this.now();
          this.emitSync({ type: "synced-durable" });
        } catch (error) {
          this.emitSync({ type: "error", message: error instanceof Error ? error.message : String(error) });
          return;
        }
      }
    })().finally(() => { this.flushPromise = null; });
    return this.flushPromise;
  }

  flushBeacon() {
    void this.flushNow(true);
  }

  private scheduleTokenRefresh() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    const expiry = Date.parse(this.session.realtimeExpiresAt);
    if (!Number.isFinite(expiry)) return;
    const delay = Math.max(1_000, expiry - this.now() - 60_000);
    this.refreshTimer = window.setTimeout(() => {
      void this.refreshNow().catch(() => {});
    }, Math.min(delay, 2_147_000_000));
  }

  async refreshNow() {
    if (this.destroyed || this.closing) return;
    try {
      const next = await this.api.openSession(this.access.token, this.session.currentSequence);
      await this.applyDurableSession(next);
      await this.realtime?.setAuth(next.realtimeToken);
      this.scheduleTokenRefresh();
      void this.flushNow();
    } catch (error) {
      this.emitSync({ type: "error", message: error instanceof Error ? error.message : String(error) });
      this.refreshTimer = window.setTimeout(() => void this.refreshNow().catch(() => {}), 10_000);
      throw error;
    }
  }

  async destroy() {
    if (this.destroyed || this.closing) return;
    this.closing = true;
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    await this.pendingPersistence.catch(() => {});
    await this.flushNow(true);
    this.destroyed = true;
    this.connected = false;
    try { await this.realtime?.dispose(); } catch { /* best effort */ }
    this.realtime = null;
    this.outbox.close();
  }
}
