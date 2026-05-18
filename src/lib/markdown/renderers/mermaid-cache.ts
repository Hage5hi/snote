// Singleton LRU cache cho mermaid SVG output. Key gắn theme vì cùng code +
// theme khác = SVG khác. Insertion-order eviction khi size > MAX.
// Mục đích Phase 6: skip mermaid.render() call khi user xem lại note đã render
// trước đó, hoặc khi cùng diagram xuất hiện trong nhiều note.

const CACHE_MAX = 30;
const cache = new Map<string, string>();

function keyOf(code: string, theme: "dark" | "light"): string {
  return `${theme}:${code}`;
}

export function getCachedMermaid(code: string, theme: "dark" | "light"): string | undefined {
  const k = keyOf(code, theme);
  const hit = cache.get(k);
  if (hit !== undefined) {
    cache.delete(k);
    cache.set(k, hit);
  }
  return hit;
}

export function setCachedMermaid(code: string, theme: "dark" | "light", svg: string): void {
  const k = keyOf(code, theme);
  if (cache.has(k)) cache.delete(k);
  cache.set(k, svg);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// Test-only: reset between unit tests.
export function __resetMermaidCacheForTests(): void {
  cache.clear();
}
