export function encodeCapabilityPayload(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** 32-byte random owner candidate, encoded as a 43-character capability token. */
export function newOwnerCandidate(): string {
  return encodeCapabilityPayload(crypto.getRandomValues(new Uint8Array(32)));
}

export function decodeCapabilityPayload(value: string): Uint8Array {
  if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9_+/=-]+$/.test(value)) {
    throw new Error("invalid capability payload");
  }
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(standard + "=".repeat((4 - standard.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function capabilityPayloadId(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", stable));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
