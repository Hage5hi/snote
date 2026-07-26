export const MAX_SNOTE_AUTH_CHARS = 8_192;

export type VerifiedRealtimeAuth =
  | { mode: "polling" }
  | {
    mode: "private-realtime";
    token: string;
    userId: string;
    issuedAt: number;
    expiresAt: number;
  }
  | { mode: "unavailable" };

export function classifyGetUserError(
  status: unknown,
): { mode: "polling" } | { mode: "unavailable" } {
  const numericStatus = Number(status);
  return Number.isFinite(numericStatus) && numericStatus >= 500
    ? { mode: "unavailable" }
    : { mode: "polling" };
}

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isBoundedJwt(token: string): boolean {
  return token.length > 0
    && token.length <= MAX_SNOTE_AUTH_CHARS
    && JWT_RE.test(token);
}

export function readSnoteAuthHeader(req: Request): string | null {
  const token = req.headers.get("x-snote-auth")?.trim() ?? "";
  return isBoundedJwt(token) ? token : null;
}

export function decodeUntrustedJwtPayload(token: string): Record<string, unknown> | null {
  if (!isBoundedJwt(token)) return null;
  const segment = token.split(".")[1];
  if (!segment || segment.length % 4 === 1) return null;

  try {
    const standard = segment.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(standard + "=".repeat((4 - standard.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function hasAuthenticatedAudience(audience: unknown): boolean {
  if (audience === "authenticated") return true;
  return Array.isArray(audience)
    && audience.every((value) => typeof value === "string")
    && audience.includes("authenticated");
}

export function assessVerifiedClaims(
  token: string,
  claims: Record<string, unknown>,
  expectedIssuer: string,
  nowSeconds: number,
): Exclude<VerifiedRealtimeAuth, { mode: "unavailable" }> {
  const issuedAt = claims.iat;
  const expiresAt = claims.exp;
  const userId = claims.sub;
  if (
    !isBoundedJwt(token)
    || typeof expectedIssuer !== "string"
    || expectedIssuer.length === 0
    || !Number.isSafeInteger(nowSeconds)
    || claims.iss !== expectedIssuer
    || !hasAuthenticatedAudience(claims.aud)
    || claims.role !== "authenticated"
    || claims.is_anonymous !== true
    || typeof userId !== "string"
    || !UUID_RE.test(userId)
    || !Number.isSafeInteger(issuedAt)
    || !Number.isSafeInteger(expiresAt)
  ) return { mode: "polling" };

  const issuedAtSeconds = Number(issuedAt);
  const expiresAtSeconds = Number(expiresAt);
  // Realtime authorizes the platform token itself, so it must not outlive the
  // database membership's five-minute ceiling. Long-lived Auth sessions use
  // the durable HTTP polling path instead.
  if (
    issuedAtSeconds > nowSeconds
    || nowSeconds >= expiresAtSeconds
    || expiresAtSeconds <= issuedAtSeconds
    || expiresAtSeconds - issuedAtSeconds > 300
  ) return { mode: "polling" };

  return {
    mode: "private-realtime",
    token,
    userId,
    issuedAt: issuedAtSeconds,
    expiresAt: expiresAtSeconds,
  };
}
