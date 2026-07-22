export type EncryptionPinState = "clear" | "pinned" | "unavailable";

const ENCRYPTION_PIN_PREFIX = "syrin:encryption-pin:";
export const ENCRYPTION_PIN_CHANGE_EVENT = "syrin:encryption-pin-change";

export function encryptionPinStorageKey(slug: string): string {
  return `${ENCRYPTION_PIN_PREFIX}${encodeURIComponent(slug)}`;
}

function notifyPinChange(slug: string): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent(ENCRYPTION_PIN_CHANGE_EVENT, {
    detail: { slug },
  }));
}

/**
 * Returns a durable, local downgrade guard for a note locator.
 *
 * Storage failures are reported separately so callers can fail closed rather
 * than treating a denied localStorage read as proof that a note was never
 * encrypted.
 */
export function getEncryptionPinState(slug: string): EncryptionPinState {
  if (!slug) return "unavailable";
  try {
    return globalThis.localStorage.getItem(encryptionPinStorageKey(slug)) === "1" ? "pinned" : "clear";
  } catch {
    return "unavailable";
  }
}

/** Persist the encrypted-state observation synchronously before any note data mounts. */
export function markNoteEncrypted(slug: string): boolean {
  if (!slug) return false;
  try {
    globalThis.localStorage.setItem(encryptionPinStorageKey(slug), "1");
    const persisted = globalThis.localStorage.getItem(encryptionPinStorageKey(slug)) === "1";
    if (persisted) notifyPinChange(slug);
    return persisted;
  } catch {
    return false;
  }
}

/** Clear only after the server has acknowledged an explicit decrypt operation. */
export function clearNoteEncryptionPin(slug: string): boolean {
  if (!slug) return false;
  try {
    globalThis.localStorage.removeItem(encryptionPinStorageKey(slug));
    const cleared = globalThis.localStorage.getItem(encryptionPinStorageKey(slug)) === null;
    if (cleared) notifyPinChange(slug);
    return cleared;
  } catch {
    return false;
  }
}
