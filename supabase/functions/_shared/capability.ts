export const CAPABILITY_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const UPDATE_ID_RE = /^[a-f0-9]{64}$/;

export type CapabilityScope = "owner" | "edit" | "view";

const encoder = new TextEncoder();
const CAPABILITY_HMAC_DOMAIN = encoder.encode("snote-capability-v1\0");
const ADMISSION_HMAC_DOMAIN = encoder.encode("snote-capability-admission-v1\0");

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function isIpLiteral(value: string): boolean {
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) return ipv4.slice(1).every((part) => Number(part) <= 255);
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return false;
  try {
    return new URL(`http://[${value}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

export function createCapabilityToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function readCapabilityBearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  return match?.[1] ?? null;
}

export async function hashCapabilityToken(token: string, secret: string): Promise<string> {
  if (!CAPABILITY_TOKEN_RE.test(token)) throw new Error("invalid capability");
  const secretBytes = encoder.encode(secret);
  if (secretBytes.byteLength < 32) throw new Error("capability configuration unavailable");

  const material = new Uint8Array(CAPABILITY_HMAC_DOMAIN.byteLength + 43);
  material.set(CAPABILITY_HMAC_DOMAIN, 0);
  material.set(encoder.encode(token), CAPABILITY_HMAC_DOMAIN.byteLength);
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, material);
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Hash the gateway-authenticated request subject without retaining an address.
 * A forwarded chain is rejected. Hosted rollout must prove that Cloudflare
 * owns and overwrites CF-Connecting-IP instead of accepting client input.
 */
export async function hashCapabilityAdmissionSubject(
  req: Request,
  secret: string,
): Promise<string | null> {
  const rawAddress = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  const secretBytes = encoder.encode(secret);
  if (
    !rawAddress
    || rawAddress.includes(",")
    || rawAddress.length > 45
    || !isIpLiteral(rawAddress)
    || secretBytes.byteLength < 32
  ) return null;

  try {
    const material = new Uint8Array(ADMISSION_HMAC_DOMAIN.byteLength + rawAddress.length);
    material.set(ADMISSION_HMAC_DOMAIN);
    material.set(encoder.encode(rawAddress), ADMISSION_HMAC_DOMAIN.byteLength);
    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, material)));
  } catch {
    return null;
  }
}

export function decodeCapabilityPayload(value: unknown, maxBytes: number): Uint8Array {
  if (
    typeof value !== "string"
    || !Number.isSafeInteger(maxBytes)
    || maxBytes < 1
    || value.length === 0
    || value.length > Math.ceil(maxBytes * 4 / 3) + 2
    || !/^[A-Za-z0-9_-]+$/.test(value)
    || value.length % 4 === 1
  ) {
    throw new Error(typeof value === "string" && value.length > Math.ceil(maxBytes * 4 / 3) + 2
      ? "payload too large"
      : "invalid payload");
  }

  try {
    const standard = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(standard + "=".repeat((4 - standard.length % 4) % 4));
    if (binary.length > maxBytes) throw new Error("payload too large");
    const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytesToBase64Url(decoded) !== value) throw new Error("invalid payload");
    return decoded;
  } catch (error) {
    if (error instanceof Error && error.message === "payload too large") throw error;
    throw new Error("invalid payload");
  }
}

export function encodeCapabilityPayload(bytes: Uint8Array): string {
  return bytesToBase64Url(bytes);
}

export async function sha256CapabilityPayload(bytes: Uint8Array): Promise<string> {
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes);
  return bytesToHex(new Uint8Array(digest));
}
