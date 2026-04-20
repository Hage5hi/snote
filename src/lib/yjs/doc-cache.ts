// Tiny LRU cache of Y.Doc instances keyed by slug, so navigating back to a
// note that was just open is instantaneous (no IDB roundtrip, no server
// fetch, no provider reconnect cost on the data side).
//
// We only cache the Y.Doc + a refCount + a TTL — the provider/awareness/idb
// lifecycle is still owned by NotePage. Cached doc is returned to a fresh
// page mount; if nobody picks it up within `IDLE_MS`, we destroy it to free
// memory.
import * as Y from "yjs";

interface Entry {
  doc: Y.Doc;
  releasedAt: number;
  destroyTimer: number | null;
}

const MAX = 3;
const IDLE_MS = 60_000;
const cache = new Map<string, Entry>();

export function acquireDoc(slug: string): Y.Doc {
  const existing = cache.get(slug);
  if (existing) {
    if (existing.destroyTimer) {
      window.clearTimeout(existing.destroyTimer);
      existing.destroyTimer = null;
    }
    cache.delete(slug);
    cache.set(slug, existing); // mark as most-recent
    return existing.doc;
  }
  const doc = new Y.Doc();
  cache.set(slug, { doc, releasedAt: 0, destroyTimer: null });
  trim();
  return doc;
}

/** Release ownership; doc stays warm for IDLE_MS, then is destroyed. */
export function releaseDoc(slug: string) {
  const entry = cache.get(slug);
  if (!entry) return;
  entry.releasedAt = Date.now();
  if (entry.destroyTimer) window.clearTimeout(entry.destroyTimer);
  entry.destroyTimer = window.setTimeout(() => {
    const cur = cache.get(slug);
    if (!cur) return;
    cache.delete(slug);
    try { cur.doc.destroy(); } catch { /* ignore */ }
  }, IDLE_MS);
}

function trim() {
  while (cache.size > MAX) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) return;
    const entry = cache.get(oldest);
    cache.delete(oldest);
    if (entry) {
      if (entry.destroyTimer) window.clearTimeout(entry.destroyTimer);
      try { entry.doc.destroy(); } catch { /* ignore */ }
    }
  }
}
