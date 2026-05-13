// Module-level singleton LRU cache for the Preview render pipeline.
// Key = post-`expandWikiLinks` text; value = sanitized HTML string.
// Map iteration order = insertion order, so we get LRU semantics by
// re-inserting on hit and evicting from the front on overflow.
//
// One global singleton on purpose: split-view mounts two Preview
// instances against the same Y.Doc content; sharing the cache lets
// the second instance skip the entire marked+DOMPurify pipeline.

const CACHE_MAX = 50;
const cache = new Map<string, string>();

export function getCachedHtml(text: string): string | undefined {
  const hit = cache.get(text);
  if (hit !== undefined) {
    // LRU touch: re-insert moves to end of insertion order.
    cache.delete(text);
    cache.set(text, hit);
  }
  return hit;
}

export function setCachedHtml(text: string, html: string): void {
  if (cache.has(text)) cache.delete(text);
  cache.set(text, html);
  // Evict oldest if over budget.
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// Test-only: reset between unit tests.
export function __resetRenderCacheForTests(): void {
  cache.clear();
}
