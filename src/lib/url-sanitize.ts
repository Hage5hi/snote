// Strips cache-buster / non-whitelisted query params from a URL-like string.
// Used to keep note URLs clean across PWA update reloads.

// Known cache-buster params that MUST always be removed regardless of the
// whitelist (defense-in-depth: even if a caller forgets to whitelist).
const CACHE_BUSTER_PARAMS = new Set(["v", "ver", "version", "t", "ts", "nocache", "cachebust", "cb", "_"]);

export interface SanitizeOptions {
  /** Query keys allowed to survive. Everything else is stripped. */
  allowedParams?: Iterable<string>;
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
    if (CACHE_BUSTER_PARAMS.has(key) || !allowed.has(key)) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) url.searchParams.delete(key);
  return hadOrigin ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}
