import { CAPABILITY_TOKEN_RE } from "./url";
import { encodeCapabilityPayload } from "./encoding";

const RECOVERY_PREFIX = "snote:create-owner:";
const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

function browserStorage(): Storage {
  if (typeof window === "undefined") throw new Error("secure note recovery unavailable");
  return window.localStorage;
}

/** Persist before the first mutating request so a lost response is recoverable. */
export function loadOrCreateOwnerCandidate(
  slug: string,
  storage: Storage = browserStorage(),
): string {
  if (!SLUG_RE.test(slug)) throw new Error("invalid slug");
  const key = `${RECOVERY_PREFIX}${slug}`;
  try {
    const existing = storage.getItem(key);
    if (existing !== null) {
      if (!CAPABILITY_TOKEN_RE.test(existing)) {
        throw new Error("secure note recovery conflict");
      }
      return existing;
    }
    const candidate = encodeCapabilityPayload(crypto.getRandomValues(new Uint8Array(32)));
    storage.setItem(key, candidate);
    if (storage.getItem(key) !== candidate) {
      throw new Error("secure note recovery unavailable");
    }
    return candidate;
  } catch (error) {
    if (error instanceof Error && error.message === "secure note recovery conflict") throw error;
    throw new Error("secure note recovery unavailable");
  }
}

export function clearCreateRecovery(
  slug: string,
  owner: string,
  storage: Storage = browserStorage(),
): void {
  if (!SLUG_RE.test(slug) || !CAPABILITY_TOKEN_RE.test(owner)) return;
  const key = `${RECOVERY_PREFIX}${slug}`;
  try {
    if (storage.getItem(key) === owner) storage.removeItem(key);
  } catch {
    // The owner has already been committed to the URL fragment. Cleanup is
    // best-effort and must not turn a successful creation into an error.
  }
}
