import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as bcrypt from "https://esm.sh/bcryptjs@2.4.3";

const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type AdminSessionAuthorization =
  | { status: "authorized"; subjectHash: string; tokenHash: string }
  | { status: "unauthorized" }
  | { status: "unavailable" };

export type AdminPassVerification =
  | { available: true; valid: true; credentialEpoch: number }
  | { available: true; valid: false }
  | { available: false; valid: false };

type CredentialMaterialRow = {
  pass_hash?: unknown;
  credential_epoch?: unknown;
};

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function serviceUnavailableResponse(
  corsHeaders: Record<string, string>,
): Response {
  return jsonResponse({ error: "temporarily unavailable" }, 503, corsHeaders);
}

export function adminAuthResponse(
  result: Exclude<AdminSessionAuthorization, { status: "authorized" }>,
  corsHeaders: Record<string, string>,
): Response {
  return result.status === "unavailable"
    ? serviceUnavailableResponse(corsHeaders)
    : jsonResponse({ error: "unauthorized" }, 401, corsHeaders);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function isIpLiteral(value: string): boolean {
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    return ipv4.slice(1).every((part) => Number(part) <= 255);
  }

  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return false;
  try {
    const parsed = new URL(`http://[${value}]/`);
    return parsed.hostname.length > 2;
  } catch {
    return false;
  }
}

export async function getAdminSubjectHash(
  req: Request,
): Promise<{ ok: true; subjectHash: string } | { ok: false }> {
  // Supabase's managed API edge runs behind Cloudflare. Hosted rollout must
  // prove that client input is rejected or overwritten before trusting this.
  const rawIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (!rawIp || rawIp.includes(",") || rawIp.length > 45 || !isIpLiteral(rawIp)) {
    return { ok: false };
  }

  const secret = Deno.env.get("ADMIN_RATE_LIMIT_HMAC_SECRET") ?? "";
  const secretBytes = new TextEncoder().encode(secret);
  if (secretBytes.byteLength < 32) return { ok: false };

  try {
    const key = await crypto.subtle.importKey("raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC",
      key,
      new TextEncoder().encode(rawIp),
    );
    return { ok: true, subjectHash: bytesToHex(new Uint8Array(signature)) };
  } catch {
    return { ok: false };
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function authorizeAdminSession(
  req: Request,
  supabase: SupabaseClient,
): Promise<AdminSessionAuthorization> {
  const subject = await getAdminSubjectHash(req);
  if (!subject.ok) return { status: "unavailable" };

  const token = req.headers.get("x-admin-session")?.trim() ?? "";
  if (!SESSION_TOKEN_RE.test(token)) return { status: "unauthorized" };

  try {
    const tokenHash = await sha256Hex(token);
    const { data, error } = await supabase.rpc("admin_session_validate", {
      p_token_hash: tokenHash,
      p_subject_hash: subject.subjectHash,
    });
    if (error) return { status: "unavailable" };
    if (data !== true) return { status: "unauthorized" };

    return {
      status: "authorized",
      subjectHash: subject.subjectHash,
      tokenHash,
    };
  } catch {
    return { status: "unavailable" };
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function verifyAdminPass(
  supabase: SupabaseClient,
  input: string,
): Promise<AdminPassVerification> {
  try {
    const { data, error } = await supabase.rpc("admin_credential_material");
    if (error) return { available: false, valid: false };

    const row: CredentialMaterialRow | undefined = Array.isArray(data)
      ? (data[0] as CredentialMaterialRow | undefined)
      : (data as CredentialMaterialRow | undefined);
    const credentialEpoch = Number(row?.credential_epoch);
    if (!Number.isSafeInteger(credentialEpoch) || credentialEpoch < 1) {
      return { available: false, valid: false };
    }

    const storedHash = typeof row?.pass_hash === "string" ? row.pass_hash : "";
    if (storedHash) {
      const valid = await bcrypt.compare(input, storedHash);
      return valid
        ? { available: true, valid: true, credentialEpoch }
        : { available: true, valid: false };
    }

    const expected = Deno.env.get("ADMIN_PASSPHRASE") ?? "";
    if (!expected) return { available: false, valid: false };
    return constantTimeEqual(input, expected)
      ? { available: true, valid: true, credentialEpoch }
      : { available: true, valid: false };
  } catch {
    return { available: false, valid: false };
  }
}

export async function hashAdminPass(input: string): Promise<string> {
  return await bcrypt.hash(input, 12);
}
