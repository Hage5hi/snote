// Strips cache-buster / non-whitelisted query params from a URL-like string.
// Used to keep note URLs clean across PWA update reloads.

// Known cache-buster params that MUST always be removed regardless of the
// whitelist (defense-in-depth: even if a caller forgets to whitelist).
const CACHE_BUSTER_PARAMS = new Set(["v", "ver", "version", "t", "ts", "nocache", "cachebust", "cb", "_"]);

export interface SanitizeOptions {
  /** Query keys allowed to survive. Everything else is stripped. */
  allowedParams?: Iterable<string>;
  /**
   * Optional trace hook fired ONLY when at least one param was stripped.
   * Receives the original URL, the sanitized URL, and the list of removed
   * keys (cache-busters + non-whitelisted). Useful for UI/backend logging.
   */
  onStrip?: (info: { original: string; sanitized: string; removed: string[] }) => void;
  /**
   * When true (default) and `onStrip` is not provided, log stripped params
   * to the console for post-mortem tracing. Set to false to stay silent.
   */
  log?: boolean;
}

/**
 * Return `input` with disallowed query params removed. Pathname, hash, and
 * ordering of the remaining params are preserved. Accepts an absolute URL or
 * a path-with-query (falls back to a dummy origin for parsing).
 */
export function sanitizeUrl(input: string, options: SanitizeOptions = {}): string {
  const allowed = new Set(options.allowedParams ?? []);
  let url: URL;
  let hadOrigin = true;
  try {
    url = new URL(input);
  } catch {
    hadOrigin = false;
    try {
      url = new URL(input, "http://x.invalid");
    } catch {
      return input;
    }
  }
  const keysToDelete: string[] = [];
  for (const key of url.searchParams.keys()) {
    if (CACHE_BUSTER_PARAMS.has(key.toLowerCase()) || !allowed.has(key)) {
      keysToDelete.push(key);
    }
  }
  // Use array (not Set) so duplicate keys are all removed by repeated delete().
  for (const key of keysToDelete) url.searchParams.delete(key);
  const sanitized = hadOrigin ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  if (keysToDelete.length > 0) {
    if (options.onStrip) {
      options.onStrip({ original: input, sanitized, removed: keysToDelete });
    } else if (options.log !== false && typeof console !== "undefined") {
      console.info("[url-sanitize] stripped query params", {
        original: input,
        sanitized,
        removed: keysToDelete,
      });
    }
  }
  return sanitized;
}
