export const CAPABILITY_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const UPDATE_ID_RE = /^[a-f0-9]{64}$/;

export type CapabilityScope = "owner" | "edit" | "view";

const encoder = new TextEncoder();
const CAPABILITY_HMAC_DOMAIN = encoder.encode("snote-capability-v1\0");

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function utf8ToBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
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

type RealtimeJwtInput = {
  capabilityId: string;
  noteId: string;
  scope: CapabilityScope;
  generation: number;
  issuer: string;
  secret: string;
  nowSeconds?: number;
  writeDisabled?: boolean;
};

export async function signRealtimeJwt(input: RealtimeJwtInput): Promise<string> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const secretBytes = encoder.encode(input.secret);
  if (
    !uuid.test(input.capabilityId)
    || !uuid.test(input.noteId)
    || !["owner", "edit", "view"].includes(input.scope)
    || !Number.isSafeInteger(input.generation)
    || input.generation < 1
    || secretBytes.byteLength < 32
  ) throw new Error("realtime JWT configuration unavailable");

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = utf8ToBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = utf8ToBase64Url(JSON.stringify({
    iss: input.issuer,
    aud: "authenticated",
    role: "authenticated",
    sub: input.capabilityId,
    note_id: input.noteId,
    note_scope: input.scope,
    capability_generation: input.generation,
    note_write_disabled: !!input.writeDisabled,
    iat: now,
    nbf: now - 5,
    exp: now + 300,
  }));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
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
