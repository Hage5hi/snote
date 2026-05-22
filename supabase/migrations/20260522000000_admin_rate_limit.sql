-- Brute-force protection for admin/cleanup edge functions.
-- The `verifyPass` helper in admin-list/admin-delete/admin-rotate/cleanup
-- previously had no rate limit, so an attacker with knowledge of the
-- endpoint could grind the bcrypt hash unimpeded. This table tracks
-- failed-auth attempts per client IP; see
-- supabase/functions/_shared/admin-rate-limit.ts for the policy.

CREATE TABLE IF NOT EXISTS public.admin_auth_attempts (
  ip text PRIMARY KEY,
  failure_count integer NOT NULL DEFAULT 0,
  first_failure_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

-- Service-role-only. RLS is enabled with no permissive policies, so
-- anon/authenticated clients can neither read nor write the counter.
ALTER TABLE public.admin_auth_attempts ENABLE ROW LEVEL SECURITY;

-- Defense in depth: an explicit restrictive policy guarantees that no
-- future permissive policy can ever expose the counter to non-service
-- callers (mirrors the pattern used on admin_config).
CREATE POLICY "Deny all reads on admin_auth_attempts"
  ON public.admin_auth_attempts
  AS RESTRICTIVE
  FOR SELECT
  TO anon, authenticated
  USING (false);

CREATE POLICY "Deny all writes on admin_auth_attempts"
  ON public.admin_auth_attempts
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Stale rows accumulate over time (one row per IP that ever failed).
-- Index keeps the routine "any locked rows for this ip?" check fast and
-- supports a periodic cleanup `DELETE WHERE locked_until < now() - '7 days'`
-- if operators want to prune.
CREATE INDEX IF NOT EXISTS idx_admin_auth_attempts_locked_until
  ON public.admin_auth_attempts (locked_until);
