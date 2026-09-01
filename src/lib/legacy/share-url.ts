const LEGACY_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

const CONFIGURED_LEGACY_SHARE_CUTOFF = import.meta.env.VITE_LEGACY_SHARE_CUTOFF ?? "";

/** Invalid/missing deployment configuration expires compatibility immediately. */
export function legacyShareCutoffMs(value = CONFIGURED_LEGACY_SHARE_CUTOFF): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value === new Date(parsed).toISOString() ? parsed : 0;
}

export function sanitizeLegacyShareLocation(
  pathname: string,
  hash: string,
  now = Date.now(),
  cutoffMs = legacyShareCutoffMs(),
): string | null {
  const match = pathname.match(/^\/s\/([A-Za-z0-9_-]{16,64})\/?$/);
  if (!match) return null;
  if (!cutoffMs || now >= cutoffMs) return "/s#legacy-expired=1";
  const params = new URLSearchParams({ legacy: match[1] });
  if (hash.length > 1) {
    try {
      params.set("key", decodeURIComponent(hash.slice(1)));
    } catch {
      // A malformed legacy key is deliberately discarded.
    }
  }
  return `/s#${params.toString()}`;
}

export function parseLegacyShareFragment(hash: string, now = Date.now(), cutoffMs = legacyShareCutoffMs()): {
  token: string;
  encryptionSecret: string;
} | null {
  if (!cutoffMs || now >= cutoffMs || !hash.startsWith("#")) return null;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("legacy") ?? "";
  if (!LEGACY_TOKEN_RE.test(token)) return null;
  return { token, encryptionSecret: params.get("key") ?? "" };
}

/** Runs before BrowserRouter so old path tokens do not survive in SPA history. */
export function sanitizeLegacyShareUrl(location: Location, history: History, now = Date.now()): boolean {
  const replacement = sanitizeLegacyShareLocation(location.pathname, location.hash, now);
  if (!replacement) return false;
  history.replaceState(history.state, "", replacement);
  return true;
}
