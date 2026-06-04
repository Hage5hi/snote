// Tiny LRU cache of Y.Doc instances keyed by slug, so navigating back to a
// note that was just open is instantaneous (no IDB roundtrip, no server
// fetch, no provider reconnect cost on the data side).
//
// We only cache the Y.Doc + a refCount + a TTL — the provider/awareness/idb
// lifecycle is still owned by NotePage. Cached doc is returned to a fresh
// page mount; if nobody picks it up within `IDLE_MS`, we destroy it to free
// memory.
//
// Note: this cache is module-level, so it's wiped on F5/reload (fresh realm).
// The tuning below only affects in-session SPA navigation across notes.
import * as Y from "yjs";

interface Entry {
  doc: Y.Doc;
  releasedAt: number;
  destroyTimer: number | null;
}

// Conservative cap: keep at most 2 warm docs so we return memory to GC sooner
// when the user opens many notes in a single session.
const MAX = 2;
// Shorter idle window (30s) before destroying a released doc. Re-opening the
// note within this window is still instantaneous; after it, we just re-hydrate
// from IndexedDB (local, fast).
const IDLE_MS = 30_000;
const cache = new Map<string, Entry>();

export function acquireDoc(slug: string): Y.Doc {
  const existing = cache.get(slug);
  if (existing) {
    if (existing.destroyTimer) {
      window.clearTimeout(existing.destroyTimer);
      existing.destroyTimer = null;
    }
    existing.releasedAt = 0;
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

// Drop all released docs when the tab becomes hidden — gives memory back to
// the OS sooner when the user switches tabs or locks the screen. Docs that
// are still actively held by a NotePage (no destroyTimer, releasedAt === 0)
// are left alone so the active page keeps working when the tab returns.
function destroyReleased() {
  for (const [slug, entry] of cache) {
    if (!entry.destroyTimer && entry.releasedAt === 0) continue; // in use
    if (entry.destroyTimer) window.clearTimeout(entry.destroyTimer);
    try { entry.doc.destroy(); } catch { /* ignore */ }
    cache.delete(slug);
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") destroyReleased();
  });
}
