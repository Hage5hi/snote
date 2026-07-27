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
  destroyTimer: ReturnType<typeof setTimeout> | null;
}

// Defaults. Production should rarely override; tests inject via __configure.
const DEFAULT_MAX = 2;
const DEFAULT_IDLE_MS = 30_000;

// Validate config: any non-finite / non-positive value falls back silently
// so a bad import-time env never breaks the cache in production.
function sanitizeMax(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_MAX;
}
function sanitizeIdle(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_IDLE_MS;
}

// Read optional Vite env overrides at module load. Bad values fall back.
function readEnvOverrides(): { max: number; idleMs: number } {
  let max: unknown;
  let idleMs: unknown;
  try {
    const env = (import.meta as { env?: Record<string, unknown> }).env ?? {};
    max = Number(env.VITE_DOC_CACHE_MAX);
    idleMs = Number(env.VITE_DOC_CACHE_IDLE_MS);
  } catch {
    /* ignore */
  }
  return { max: sanitizeMax(max), idleMs: sanitizeIdle(idleMs) };
}

let { max: MAX, idleMs: IDLE_MS } = readEnvOverrides();
const cache = new Map<string, Entry>();

// Debug logger. Off by default. Toggle by setting localStorage key
// `debug:doc-cache` to "1", or via __setDebug(true) in tests.
let debugEnabled = false;
function readDebugFromStorage(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("debug:doc-cache") === "1";
  } catch {
    return false;
  }
}
debugEnabled = readDebugFromStorage();

let destroyCount = 0;
let acquireHitCount = 0;
let acquireMissCount = 0;
function log(event: string, detail?: Record<string, unknown>) {
  if (!debugEnabled) return;
  console.debug(`[doc-cache] ${event}`, { MAX, IDLE_MS, size: cache.size, destroyed: destroyCount, ...detail });
}

/**
 * Stable snapshot of cache lifecycle counters. Exposed both as a named
 * export and (in dev) on `window.__docCacheMetrics` so Playwright specs
 * can read it without bundling test-only code into prod chunks.
 */
export interface DocCacheMetrics {
  max: number;
  idleMs: number;
  size: number;
  acquireHit: number;
  acquireMiss: number;
  destroyed: number;
  debug: boolean;
}

export function getDocCacheMetrics(): DocCacheMetrics {
  return {
    max: MAX,
    idleMs: IDLE_MS,
    size: cache.size,
    acquireHit: acquireHitCount,
    acquireMiss: acquireMissCount,
    destroyed: destroyCount,
    debug: debugEnabled,
  };
}

export function acquireDoc(slug: string): Y.Doc {
  const existing = cache.get(slug);
  if (existing) {
    if (existing.destroyTimer) {
      clearTimeout(existing.destroyTimer);
      existing.destroyTimer = null;
    }
    existing.releasedAt = 0;
    cache.delete(slug);
    cache.set(slug, existing); // mark as most-recent
    acquireHitCount++;
    log("acquire:hit", { locatorLength: slug.length });
    return existing.doc;
  }
  const doc = new Y.Doc();
  cache.set(slug, { doc, releasedAt: 0, destroyTimer: null });
  acquireMissCount++;
  log("acquire:miss", { locatorLength: slug.length });
  trim();
  return doc;
}

/** Release ownership; doc stays warm for IDLE_MS, then is destroyed. */
export function releaseDoc(slug: string) {
  const entry = cache.get(slug);
  if (!entry) return;
  entry.releasedAt = Date.now();
  if (entry.destroyTimer) clearTimeout(entry.destroyTimer);
  entry.destroyTimer = setTimeout(() => {
    const cur = cache.get(slug);
    if (!cur) return;
    cache.delete(slug);
    try { cur.doc.destroy(); } catch { /* ignore */ }
    destroyCount++;
    log("destroy:idle", { locatorLength: slug.length });
  }, IDLE_MS);
  log("release", { locatorLength: slug.length });
}

/** Immediately remove and destroy a cached doc for slugs that were renamed away. */
export function evictDoc(slug: string) {
  const entry = cache.get(slug);
  if (!entry) return;
  if (entry.destroyTimer) clearTimeout(entry.destroyTimer);
  cache.delete(slug);
  try { entry.doc.destroy(); } catch { /* ignore */ }
  destroyCount++;
  log("destroy:evict", { locatorLength: slug.length });
}

/** True when a slug still has a warm Y.Doc in this tab's in-memory cache. */
export function isDocCached(slug: string) {
  return cache.has(slug);
}

function trim() {
  while (cache.size > MAX) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) return;
    const entry = cache.get(oldest);
    cache.delete(oldest);
    if (entry) {
      if (entry.destroyTimer) clearTimeout(entry.destroyTimer);
      try { entry.doc.destroy(); } catch { /* ignore */ }
      destroyCount++;
      log("destroy:trim", { locatorLength: oldest.length });
    }
  }
}

// Drop all released docs when the tab becomes hidden — gives memory back to
// the OS sooner when the user switches tabs or locks the screen. Docs that
// are still actively held by a NotePage (no destroyTimer, releasedAt === 0)
// are left alone so the active page keeps working when the tab returns.
function destroyReleased() {
  let removed = 0;
  for (const [slug, entry] of cache) {
    // In-use means: never released (releasedAt === 0) AND no pending destroy.
    if (entry.destroyTimer === null && entry.releasedAt === 0) continue;
    if (entry.destroyTimer) clearTimeout(entry.destroyTimer);
    try { entry.doc.destroy(); } catch { /* ignore */ }
    cache.delete(slug);
    destroyCount++;
    removed++;
  }
  log("destroy:hidden", { removed });
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") destroyReleased();
  });
}

// Expose a metrics getter on `window` so Playwright specs and devtools can
// snapshot lifecycle counters without importing the singleton. Gated to
// dev / debug to keep prod globals clean. Tree-shaken in non-dev when the
// flag is off (the condition itself is cheap and runs once).
if (typeof window !== "undefined") {
  const w = window as unknown as { __docCacheMetrics?: () => DocCacheMetrics };
  if (import.meta.env?.DEV || debugEnabled) {
    w.__docCacheMetrics = getDocCacheMetrics;
  }
}

// ---- Test / debug surface ---------------------------------------------------
// Not exported from the public package — only consumed by tests and the
// debug toggle in devtools. Keeping the surface here (rather than a separate
// module) avoids re-importing the singleton cache map.

export const __docCacheInternals = {
  /** Override config (tests). Pass partial to reset only what you need. */
  configure(opts: { max?: number; idleMs?: number }) {
    if (opts.max !== undefined) MAX = sanitizeMax(opts.max);
    if (opts.idleMs !== undefined) IDLE_MS = sanitizeIdle(opts.idleMs);
  },
  reset() {
    for (const [, entry] of cache) {
      if (entry.destroyTimer) clearTimeout(entry.destroyTimer);
      try { entry.doc.destroy(); } catch { /* ignore */ }
    }
    cache.clear();
    destroyCount = 0;
    acquireHitCount = 0;
    acquireMissCount = 0;
    const fresh = readEnvOverrides();
    MAX = fresh.max;
    IDLE_MS = fresh.idleMs;
  },
  setDebug(on: boolean) { debugEnabled = on; },
  isDebug() { return debugEnabled; },
  getConfig() { return { MAX, IDLE_MS }; },
  getDestroyCount() { return destroyCount; },
  getMetrics: getDocCacheMetrics,
  size() { return cache.size; },
  isWarm(slug: string) { return cache.has(slug); },
  isReleased(slug: string) {
    const e = cache.get(slug);
    return e ? e.destroyTimer !== null : false;
  },
  fireVisibilityHidden() { destroyReleased(); },
};
