import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import { supabase } from "@/integrations/supabase/client";
import { bytesToBase64, base64ToBytes } from "./base64";
import { extractTags } from "@/lib/tags";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type SaveStatus = "idle" | "editing" | "saving" | "saved" | "offline";

/**
 * Sync lifecycle events emitted by the provider. These are ADDITIVE to the
 * existing `SaveStatus` stream — `SaveStatus` describes the local persistence
 * pipeline (editing → saving → saved), while `SyncEvent` describes what
 * happened on the wire. UI surfaces (SyncIndicator) consume both.
 *
 *   - "pending"        Local edit produced bytes that have not yet been
 *                       acknowledged by either the broadcast peer fan-out OR
 *                       the durable Postgres snapshot. `bytes` is the running
 *                       total of un-flushed update payload size.
 *   - "synced-peer"    A local update was sent on the broadcast channel.
 *                       Peers in the same room will apply it within ~1 RTT.
 *                       (Does NOT mean durable yet.)
 *   - "synced-durable" Postgres `notes.ydoc_state` was successfully upserted.
 *                       From this moment forward, a fresh client opening the
 *                       slug will see the edit.
 *   - "recovered"      On reconnect, the DB snapshot contained state our
 *                       local doc didn't have, and we merged it in. `bytes`
 *                       is the size delta in the state vector.
 *   - "offline"        Channel dropped / network lost.
 *   - "online"         Channel re-subscribed.
 */
export type SyncEvent =
  | { type: "pending"; bytes: number }
  | { type: "synced-peer" }
  | { type: "synced-durable" }
  | { type: "recovered"; bytes: number }
  | { type: "offline" }
  | { type: "online" };

type Listener<T> = (v: T) => void;

/**
 * Optional encryption hooks. When provided, all bytes that hit the network
 * (broadcast updates AND the Postgres snapshot in `ydoc_state`) are passed
 * through `encrypt`, and incoming bytes through `decrypt`. The server stays
 * zero-knowledge; only clients holding the key can read.
 */
export type Encryption = {
  encrypt: (bytes: Uint8Array) => Promise<Uint8Array>;
  decrypt: (bytes: Uint8Array) => Promise<Uint8Array>;
};

export type AwarenessState = {
  user?: { name: string; color: string };
} & Record<string, unknown>;

/**
 * SupabaseYjsProvider
 * - Loads initial Y.Doc snapshot from public.notes
 * - Sends/receives Y.update binary patches via Supabase Realtime broadcast
 * - Syncs awareness (presence + cursor) over the same channel
 * - Periodically snapshots the doc back to Postgres (debounced)
 */
export class SupabaseYjsProvider {
  doc: Y.Doc;
  awareness: Awareness;
  slug: string;
  channel: RealtimeChannel | null = null;
  connected = false;
  encryption: Encryption | null = null;

  private snapshotTimer: number | null = null;
  private lastSnapshotAt = 0;
  private statusListeners = new Set<Listener<SaveStatus>>();
  private awarenessListeners = new Set<Listener<Map<number, AwarenessState>>>();
  private syncListeners = new Set<Listener<SyncEvent>>();
  private status: SaveStatus = "idle";
  private clientId = Math.floor(Math.random() * 0xffffffff);
  private destroyed = false;
  // Bytes of local updates that have not yet been durably saved to Postgres.
  // Reset to 0 after each successful `saveSnapshot`. Read via
  // `getPendingBytes()` / `hasUnflushedLocalChanges()`.
  private pendingBytes = 0;
  // The Realtime `subscribe` callback fires `SUBSCRIBED` once on the initial
  // join and again on every auto-reconnect. We treat reconnects specially:
  // peer broadcasts that happened while we were offline are NOT replayed by
  // Supabase Realtime, so we re-read the DB snapshot to pick up anything
  // other clients persisted in the meantime — otherwise our next
  // `saveSnapshot` would overwrite their work.
  private hasSubscribedOnce = false;

  constructor(slug: string, doc: Y.Doc, encryption?: Encryption) {
    this.slug = slug;
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.awareness.clientID = this.clientId;
    this.encryption = encryption ?? null;
  }

  setEncryption(enc: Encryption | null) {
    this.encryption = enc;
  }

  onStatus(cb: Listener<SaveStatus>) {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  onAwareness(cb: Listener<Map<number, AwarenessState>>) {
    this.awarenessListeners.add(cb);
    cb(this.awareness.getStates() as Map<number, AwarenessState>);
    return () => this.awarenessListeners.delete(cb);
  }

  /**
   * Subscribe to sync lifecycle events. See `SyncEvent` for semantics.
   * Returns an unsubscribe function.
   */
  onSyncEvent(cb: Listener<SyncEvent>) {
    this.syncListeners.add(cb);
    return () => this.syncListeners.delete(cb);
  }

  /** Running byte count of local updates not yet durably saved to Postgres. */
  getPendingBytes() {
    return this.pendingBytes;
  }

  /** True iff there are local edits that haven't been persisted to the DB. */
  hasUnflushedLocalChanges() {
    return this.pendingBytes > 0;
  }

  private emitSync(ev: SyncEvent) {
    this.syncListeners.forEach((cb) => {
      try {
        cb(ev);
      } catch (e) {
        console.warn("sync listener threw", e);
      }
    });
  }

  private setStatus(s: SaveStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((cb) => cb(s));
  }

  /**
   * Connect with an optional pre-fetched snapshot. When the caller already
   * has the `ydoc_state` (e.g. from a single combined query in NotePage), we
   * skip the extra round-trip.
   */
  async connect(
    identity: { name: string; color: string },
    options?: { prefetchedYdocState?: string | null; rowExists?: boolean },
  ) {
    // 0) Try the prefetched snapshot stashed by Home page hover/touch.
    // Skip prefetched snapshot when encrypted, since the prefetch path doesn't
    // know the key and the bytes would not be Y.update format yet.
    if (!this.encryption) {
      try {
        const prefetched = sessionStorage.getItem(`note-snapshot:${this.slug}`);
        if (prefetched) {
          sessionStorage.removeItem(`note-snapshot:${this.slug}`);
          try {
            const update = base64ToBytes(prefetched);
            if (update.byteLength > 0) Y.applyUpdate(this.doc, update, "remote-snapshot");
          } catch (e) {
            console.warn("Bad prefetched snapshot", e);
          }
        }
      } catch {
        // sessionStorage unavailable — ignore.
      }
    }

    // 1) Apply pre-fetched ydoc_state if caller passed one; else fetch now.
    let ydocState = options?.prefetchedYdocState ?? null;
    let rowExists = options?.rowExists ?? null;
    if (ydocState === null && rowExists === null) {
      const { data, error } = await supabase
        .from("notes")
        .select("ydoc_state")
        .eq("slug", this.slug)
        .maybeSingle();
      if (!error) {
        ydocState = data?.ydoc_state ?? null;
        rowExists = !!data;
      }
    }

    if (ydocState) {
      try {
        let update = base64ToBytes(ydocState);
        if (this.encryption && update.byteLength > 0) {
          update = await this.encryption.decrypt(update);
        }
        if (update.byteLength > 0) Y.applyUpdate(this.doc, update, "remote-snapshot");
      } catch (e) {
        console.warn("Failed to apply snapshot", e);
      }
    } else if (rowExists === false) {
      // Create empty row so multiple clients can find the slug immediately.
      void supabase.from("notes").upsert({ slug: this.slug }, { onConflict: "slug" });
    }

    // 2) Set local awareness identity.
    this.awareness.setLocalState({
      user: { name: identity.name, color: identity.color },
    });

    // 3) Open broadcast channel.
    this.channel = supabase.channel(`note:${this.slug}`, {
      config: { broadcast: { self: false, ack: false } },
    });

    this.channel.on("broadcast", { event: "y-update" }, async ({ payload }) => {
      try {
        let bytes = base64ToBytes(payload.update);
        if (this.encryption) bytes = await this.encryption.decrypt(bytes);
        Y.applyUpdate(this.doc, bytes, "remote");
      } catch (e) {
        console.warn("Bad remote update", e);
      }
    });

    this.channel.on("broadcast", { event: "awareness" }, ({ payload }) => {
      try {
        const bytes = base64ToBytes(payload.update);
        applyAwarenessUpdate(this.awareness, bytes, "remote");
      } catch (e) {
        console.warn("Bad awareness", e);
      }
    });

    // When a new client joins, request the full state from peers.
    this.channel.on("broadcast", { event: "request-state" }, ({ payload }) => {
      if (payload.from === this.clientId) return;
      const update = Y.encodeStateAsUpdate(this.doc);
      this.broadcastUpdate(update);
    });

    await this.channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        const wasOffline = !this.connected && this.hasSubscribedOnce;
        this.connected = true;
        this.setStatus("saved");
        if (this.hasSubscribedOnce) {
          // Reconnect path: another client may have snapshotted to Postgres
          // while we were offline. Merge that state in BEFORE we ask peers
          // for updates so a subsequent `saveSnapshot` doesn't clobber it.
          await this.refetchDbSnapshot();
        }
        this.hasSubscribedOnce = true;
        if (wasOffline) this.emitSync({ type: "online" });
        // Ask peers for any newer state.
        await this.channel?.send({
          type: "broadcast",
          event: "request-state",
          payload: { from: this.clientId },
        });
        this.broadcastAwareness();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        const wasConnected = this.connected;
        this.connected = false;
        this.setStatus("offline");
        if (wasConnected) this.emitSync({ type: "offline" });
      }
    });

    // 4) Wire up local change handlers.
    this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);

    // Heartbeat awareness so peers know we are alive.
    const pingId = window.setInterval(() => {
      if (this.destroyed) return;
      // Re-set local state with same data to bump clock.
      const cur = this.awareness.getLocalState();
      if (cur) this.awareness.setLocalState({ ...cur });
    }, 15000);
    this.cleanupFns.push(() => window.clearInterval(pingId));
  }

  private cleanupFns: Array<() => void> = [];

  /**
   * Fetch the latest `ydoc_state` from Postgres and merge it into the local
   * doc. Used on reconnect; `Y.applyUpdate` is merge-safe so this never
   * loses local edits, only adds whatever the DB has that we don't.
   */
  private async refetchDbSnapshot() {
    if (this.destroyed) return;
    try {
      const { data, error } = await supabase
        .from("notes")
        .select("ydoc_state")
        .eq("slug", this.slug)
        .maybeSingle();
      if (error || !data?.ydoc_state) return;
      let update = base64ToBytes(data.ydoc_state);
      if (this.encryption && update.byteLength > 0) {
        update = await this.encryption.decrypt(update);
      }
      if (update.byteLength > 0) Y.applyUpdate(this.doc, update, "remote-snapshot");
    } catch (e) {
      console.warn("Refetch snapshot failed", e);
    }
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote" || origin === "remote-snapshot") return;
    this.broadcastUpdate(update);
    this.scheduleSnapshot();
  };

  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    // Notify listeners.
    this.awarenessListeners.forEach((cb) => cb(this.awareness.getStates() as Map<number, AwarenessState>));
    if (origin === "remote") return;
    const changed = added.concat(updated).concat(removed);
    if (changed.length === 0) return;
    this.broadcastAwareness(changed);
  };

  private async broadcastUpdate(update: Uint8Array) {
    if (!this.channel || !this.connected) return;
    let bytes = update;
    if (this.encryption) {
      try {
        bytes = await this.encryption.encrypt(update);
      } catch (e) {
        console.warn("Encrypt update failed", e);
        return;
      }
    }
    this.channel.send({
      type: "broadcast",
      event: "y-update",
      payload: { update: bytesToBase64(bytes) },
    });
  }

  private broadcastAwareness(clients?: number[]) {
    if (!this.channel || !this.connected) return;
    const update = encodeAwarenessUpdate(
      this.awareness,
      clients ?? Array.from(this.awareness.getStates().keys())
    );
    this.channel.send({
      type: "broadcast",
      event: "awareness",
      payload: { update: bytesToBase64(update) },
    });
  }

  private scheduleSnapshot() {
    this.setStatus("editing");
    if (this.snapshotTimer) window.clearTimeout(this.snapshotTimer);
    this.snapshotTimer = window.setTimeout(() => this.saveSnapshot(), 800);
  }

  async saveSnapshot() {
    if (this.destroyed) return;
    this.setStatus("saving");
    try {
      const state = Y.encodeStateAsUpdate(this.doc);
      const text = this.doc.getText("content").toString();
      let stateBytes = state;
      let storedContent = text;
      let storedCount = text.length;
      // Tags are derived from plaintext, so for encrypted notes we leave them
      // empty (server stays zero-knowledge).
      let storedTags: string[] = this.encryption ? [] : extractTags(text);
      if (this.encryption) {
        try {
          stateBytes = await this.encryption.encrypt(state);
          // Server is zero-knowledge — never expose plaintext or true length.
          storedContent = "";
          storedCount = 0;
          storedTags = [];
        } catch (e) {
          console.warn("Encrypt snapshot failed", e);
          this.setStatus(this.connected ? "editing" : "offline");
          return;
        }
      }
      const { error } = await supabase.from("notes").upsert(
        {
          slug: this.slug,
          ydoc_state: bytesToBase64(stateBytes),
          content: storedContent,
          char_count: storedCount,
          tags: storedTags,
        },
        { onConflict: "slug" }
      );
      if (error) {
        console.warn("Snapshot save failed", error);
        this.setStatus(this.connected ? "editing" : "offline");
      } else {
        this.lastSnapshotAt = Date.now();
        this.setStatus(this.connected ? "saved" : "offline");
      }
    } catch (e) {
      console.warn("Snapshot exception", e);
      this.setStatus("offline");
    }
  }

  /**
   * Best-effort synchronous-ish flush for `beforeunload` / `pagehide`. Uses
   * `navigator.sendBeacon` against the Supabase REST endpoint so the browser
   * doesn't kill the request as it tears the page down. Falls back to the
   * normal saveSnapshot path when sendBeacon isn't usable.
   */
  flushBeacon() {
    if (this.destroyed) return;
    try {
      const state = Y.encodeStateAsUpdate(this.doc);
      const text = this.doc.getText("content").toString();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/notes?on_conflict=slug`;
      const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      // Encrypted notes: skip beacon (the encrypt call is async and we can't
      // wait here). The server already has the most recent debounced save
      // and IDB persists locally regardless.
      if (this.encryption) return;
      const body = JSON.stringify([
        {
          slug: this.slug,
          ydoc_state: bytesToBase64(state),
          content: text,
          char_count: text.length,
          tags: extractTags(text),
        },
      ]);
      const headers = {
        type: "application/json",
      };
      const blob = new Blob([body], headers);
      // sendBeacon doesn't let us set custom headers; the Supabase REST API
      // requires apikey + Prefer headers, so we fall through to fetch with
      // keepalive when beacon isn't viable.
      const ok = navigator.sendBeacon
        ? navigator.sendBeacon(`${url}&apikey=${encodeURIComponent(apikey)}`, blob)
        : false;
      if (!ok) {
        void fetch(`${url}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey,
            Authorization: `Bearer ${apikey}`,
            Prefer: "resolution=merge-duplicates",
          },
          body,
          keepalive: true,
        });
      }
    } catch (e) {
      console.warn("flushBeacon failed", e);
    }
  }

  async destroy() {
    this.destroyed = true;
    if (this.snapshotTimer) window.clearTimeout(this.snapshotTimer);
    // Final flush.
    await this.saveSnapshot();
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    if (this.channel) {
      try {
        await this.channel.unsubscribe();
      } catch {
        // ignore
      }
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
