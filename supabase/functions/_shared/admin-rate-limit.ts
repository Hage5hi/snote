import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { serviceUnavailableResponse } from "./admin-auth.ts";

export { serviceUnavailableResponse };

export type LockoutResult =
  | { available: false; allowed: false }
  | { available: true; allowed: true; retryAfterSeconds: 0 }
  | { available: true; allowed: false; retryAfterSeconds: number };

type GateRow = {
  allowed?: unknown;
  retry_after_seconds?: unknown;
};

function parseGate(data: unknown): LockoutResult {
  const row: GateRow | undefined = Array.isArray(data)
    ? (data[0] as GateRow | undefined)
    : (data as GateRow | undefined);
  if (!row || typeof row.allowed !== "boolean") {
    return { available: false, allowed: false };
  }
  if (row.allowed) {
    return { available: true, allowed: true, retryAfterSeconds: 0 };
  }
  const retryAfterSeconds = Math.max(
    1,
    Math.min(1800, Number(row.retry_after_seconds) || 1800),
  );
  return { available: true, allowed: false, retryAfterSeconds };
}

export async function checkAdminLockout(
  supabase: SupabaseClient,
  subjectHash: string,
): Promise<LockoutResult> {
  const { data, error } = await supabase.rpc("admin_auth_check", {
    p_subject_hash: subjectHash,
  });
  if (error) return { available: false, allowed: false };
  return parseGate(data);
}

export async function recordAdminAuthAttempt(
  supabase: SupabaseClient,
  subjectHash: string,
  success: boolean,
): Promise<LockoutResult> {
  const { data, error } = await supabase.rpc("admin_auth_record", {
    p_subject_hash: subjectHash,
    p_success: success,
  });
  if (error) return { available: false, allowed: false };
  return parseGate(data);
}

export function lockoutResponse(
  retryAfterSeconds: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: "too many failed attempts",
      retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

