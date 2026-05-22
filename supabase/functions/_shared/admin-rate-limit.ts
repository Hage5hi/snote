// Brute-force protection for admin/cleanup endpoints.
// Tracks failed-auth attempts per client IP in `public.admin_auth_attempts`.
// Schema (created by migration 20260522000000_admin_rate_limit.sql):
//   admin_auth_attempts(ip pk, failure_count, first_failure_at, locked_until)
//
// Policy:
//   * Sliding window of WINDOW_MS — counts failures inside the window.
//   * Hitting MAX_FAILURES inside the window sets `locked_until = now + LOCK_DURATION_MS`.
//   * `checkAdminLockout` returns `{ allowed: false, retryAfterSeconds }` while a
//     lock is active; callers should return HTTP 429 with a `Retry-After` header.
//   * `recordAdminAuthAttempt(success=true)` clears the row so a single
//     correct password resets the counter and unlocks the IP.
//
// The table is service-role-only (RLS enabled, no policies) so anonymous
// clients cannot enumerate or tamper with the counter.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const WINDOW_MS = 15 * 60 * 1000;       // 15 min sliding window for failed attempts
const MAX_FAILURES = 10;                // 10 wrong passwords inside the window → lock
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 min lockout once the limit is hit

export interface LockoutAllowed {
  allowed: true;
}
export interface LockoutDenied {
  allowed: false;
  retryAfterSeconds: number;
}
export type LockoutResult = LockoutAllowed | LockoutDenied;

export function getClientIp(req: Request): string {
  // Supabase Edge Functions sit behind a reverse proxy that sets the
  // standard forwarding headers. Use the leftmost entry of
  // `x-forwarded-for`, then fall back to provider-specific headers.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function checkAdminLockout(
  supabase: SupabaseClient,
  ip: string,
): Promise<LockoutResult> {
  const { data } = await supabase
    .from("admin_auth_attempts")
    .select("locked_until")
    .eq("ip", ip)
    .maybeSingle();
  if (data?.locked_until) {
    const until = new Date(data.locked_until as string);
    const now = Date.now();
    if (until.getTime() > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((until.getTime() - now) / 1000),
      };
    }
  }
  return { allowed: true };
}

export async function recordAdminAuthAttempt(
  supabase: SupabaseClient,
  ip: string,
  success: boolean,
): Promise<void> {
  if (success) {
    await supabase.from("admin_auth_attempts").delete().eq("ip", ip);
    return;
  }

  const now = new Date();
  const { data } = await supabase
    .from("admin_auth_attempts")
    .select("failure_count, first_failure_at")
    .eq("ip", ip)
    .maybeSingle();

  if (!data) {
    await supabase
      .from("admin_auth_attempts")
      .insert({
        ip,
        failure_count: 1,
        first_failure_at: now.toISOString(),
        locked_until: null,
      });
    return;
  }

  const firstFailureAt = new Date(data.first_failure_at as string);
  const inWindow = now.getTime() - firstFailureAt.getTime() < WINDOW_MS;
  const nextCount = inWindow ? (Number(data.failure_count) || 0) + 1 : 1;
  const update: Record<string, unknown> = {
    failure_count: nextCount,
    first_failure_at: inWindow
      ? (data.first_failure_at as string)
      : now.toISOString(),
    locked_until:
      nextCount >= MAX_FAILURES
        ? new Date(now.getTime() + LOCK_DURATION_MS).toISOString()
        : null,
  };
  await supabase
    .from("admin_auth_attempts")
    .update(update)
    .eq("ip", ip);
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
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}
