// Phase 2.2 — Aggregates SupabaseYjsProvider sync state for the SyncIndicator.
//
// Strategy: POLL three cheap getters every 250ms (pendingBytes, lastBroadcastAt,
// lastSnapshotAt) AND subscribe to the low-frequency SyncEvent stream for the
// 4 transition events (offline/online/recovered/conflict/error/synced-durable).
//
// The polling avoids a render storm during burst typing — `handleDocUpdate`
// fires per-keystroke and would re-render the indicator ~30x/s if we listened
// to a "pending" event. Polling 4x/s is enough to feel live.
//
// To keep React renders ≤ ~4/s we only `setState` when the derived snapshot
// actually changes (shallow compare). Internal counters in the provider that
// don't shift the displayed status produce zero renders.
import { useEffect, useRef, useState } from "react";
import type { SupabaseYjsProvider, SyncEvent } from "@/lib/yjs/provider";

export type SyncIndicatorStatus =
  | "synced"
  | "syncing"
  | "conflict"
  | "error"
  | "offline";

export interface SyncSnapshot {
  status: SyncIndicatorStatus;
  pendingBytes: number;
  lastBroadcastAt: number;
  lastSnapshotAt: number;
  lastErrorMessage: string | null;
  lastErrorAt: number | null;
  /** True after the most-recent reconnect merged remote-only state. */
  conflictPending: boolean;
}

const POLL_MS = 250;
// How long after a broadcast send to keep the pill in "syncing" before the
// 800ms snapshot debounce flips it to "synced". Matches the snapshot debounce
// window so the pill doesn't flicker green→yellow→green between the broadcast
// and the durable save.
const SYNCING_WINDOW_MS = 1000;

interface InternalState {
  offline: boolean;
  conflictPending: boolean;
  lastErrorMessage: string | null;
  lastErrorAt: number | null;
}

/**
 * Pure derivation of the displayed sync status. Exported for unit testing
 * (Phase 9) — keep functionally equivalent to the inline logic that lived
 * in the hook body.
 *
 * Priority order: offline > error > conflict > syncing(pending) >
 * syncing(broadcast window) > synced.
 */
export interface DeriveStatusInput {
  offline: boolean;
  lastErrorMessage: string | null;
  conflictPending: boolean;
  pendingBytes: number;
  lastBroadcastAt: number;
}

export function deriveStatus(
  s: DeriveStatusInput,
  now: number = Date.now(),
): SyncIndicatorStatus {
  if (s.offline) return "offline";
  if (s.lastErrorMessage) return "error";
  if (s.conflictPending) return "conflict";
  if (s.pendingBytes > 0) return "syncing";
  if (s.lastBroadcastAt > 0 && now - s.lastBroadcastAt < SYNCING_WINDOW_MS) return "syncing";
  return "synced";
}

function snapshotsEqual(a: SyncSnapshot, b: SyncSnapshot) {
  return (
    a.status === b.status &&
    a.pendingBytes === b.pendingBytes &&
    a.lastBroadcastAt === b.lastBroadcastAt &&
    a.lastSnapshotAt === b.lastSnapshotAt &&
    a.lastErrorMessage === b.lastErrorMessage &&
    a.lastErrorAt === b.lastErrorAt &&
    a.conflictPending === b.conflictPending
  );
}

export interface UseSyncStatusReturn extends SyncSnapshot {
  /** Clear the latched error (user clicked "Bỏ qua"). */
  dismissError: () => void;
  /** Clear the conflict flag (user acknowledged). */
  dismissConflict: () => void;
}

export function useSyncStatus(
  provider: SupabaseYjsProvider | null,
): UseSyncStatusReturn {
  const internalRef = useRef<InternalState>({
    offline: false,
    conflictPending: false,
    lastErrorMessage: null,
    lastErrorAt: null,
  });
  const [snap, setSnap] = useState<SyncSnapshot>({
    status: "synced",
    pendingBytes: 0,
    lastBroadcastAt: 0,
    lastSnapshotAt: 0,
    lastErrorMessage: null,
    lastErrorAt: null,
    conflictPending: false,
  });

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;

    const recompute = () => {
      if (cancelled) return;
      const now = Date.now();
      const pendingBytes = provider.getPendingBytes();
      const lastBroadcastAt = provider.getLastBroadcastAt();
      const lastSnapshotAt = provider.getLastSnapshotAt();
      const s = internalRef.current;
      const next: SyncSnapshot = {
        status: deriveStatus(
          { offline: s.offline, lastErrorMessage: s.lastErrorMessage, conflictPending: s.conflictPending, pendingBytes, lastBroadcastAt },
          now,
        ),
        pendingBytes,
        lastBroadcastAt,
        lastSnapshotAt,
        lastErrorMessage: s.lastErrorMessage,
        lastErrorAt: s.lastErrorAt,
        conflictPending: s.conflictPending,
      };
      setSnap((prev) => (snapshotsEqual(prev, next) ? prev : next));
    };

    const unsub = provider.onSyncEvent((ev: SyncEvent) => {
      const s = internalRef.current;
      switch (ev.type) {
        case "offline":
          s.offline = true;
          break;
        case "online":
          s.offline = false;
          break;
        case "error":
          s.lastErrorMessage = ev.message;
          s.lastErrorAt = Date.now();
          break;
        case "conflict":
          s.conflictPending = true;
          break;
        case "recovered":
          // No latched flag — just trigger a recompute (toast handled by
          // NotePage subscriber).
          break;
        case "synced-durable":
          // Successful durable flush clears any stale error.
          s.lastErrorMessage = null;
          s.lastErrorAt = null;
          break;
      }
      recompute();
    });

    recompute();
    const id = window.setInterval(recompute, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      unsub();
    };
  }, [provider]);

  return {
    ...snap,
    dismissError: () => {
      const s = internalRef.current;
      s.lastErrorMessage = null;
      s.lastErrorAt = null;
      setSnap((prev) =>
        prev.lastErrorMessage === null && prev.lastErrorAt === null
          ? prev
          : { ...prev, lastErrorMessage: null, lastErrorAt: null, status: "synced" },
      );
    },
    dismissConflict: () => {
      const s = internalRef.current;
      s.conflictPending = false;
      setSnap((prev) =>
        prev.conflictPending === false
          ? prev
          : { ...prev, conflictPending: false, status: "synced" },
      );
    },
  };
}
