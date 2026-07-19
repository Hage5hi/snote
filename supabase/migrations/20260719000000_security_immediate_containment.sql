-- Immediate containment. Apply only after a verified PITR/backup checkpoint and
-- after 20260522000000_admin_rate_limit.sql. Edge consumers must be deployed
-- only after this migration succeeds.

BEGIN;

-- Slugs are locators, not authorization. Remove the legacy public DELETE path
-- without rewriting the historical migration that may already be recorded.
DROP POLICY IF EXISTS "Anyone can delete notes" ON public.notes;
REVOKE DELETE ON TABLE public.notes FROM PUBLIC;
REVOKE DELETE ON TABLE public.notes FROM anon, authenticated;

-- The first limiter migration called this column `ip`. It must contain only a
-- keyed HMAC, never a raw address. Purge any pre-containment values while
-- changing the schema contract.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'admin_auth_attempts'
      AND column_name = 'ip'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'admin_auth_attempts'
      AND column_name = 'subject_hash'
  ) THEN
    ALTER TABLE public.admin_auth_attempts RENAME COLUMN ip TO subject_hash;
  END IF;
END
$$;

TRUNCATE TABLE public.admin_auth_attempts;
COMMENT ON COLUMN public.admin_auth_attempts.subject_hash IS
  'HMAC-SHA-256 of the gateway-verified client address; never a raw IP';

REVOKE ALL ON TABLE public.admin_auth_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_auth_attempts TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '31 minutes')
);

ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.admin_sessions TO service_role;

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at
  ON public.admin_sessions (expires_at);

CREATE OR REPLACE FUNCTION public.admin_auth_check(p_subject_hash text)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_locked_until timestamptz;
  v_now timestamptz := statement_timestamp();
BEGIN
  IF p_subject_hash IS NULL OR p_subject_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT false, 1800;
    RETURN;
  END IF;

  SELECT attempts.locked_until
    INTO v_locked_until
    FROM public.admin_auth_attempts AS attempts
   WHERE attempts.subject_hash = p_subject_hash;

  IF v_locked_until IS NOT NULL AND v_locked_until > v_now THEN
    RETURN QUERY SELECT
      false,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_locked_until - v_now)))::integer);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_auth_record(
  p_subject_hash text,
  p_success boolean
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_locked_until timestamptz;
  v_now timestamptz := statement_timestamp();
BEGIN
  IF p_subject_hash IS NULL OR p_subject_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT false, 1800;
    RETURN;
  END IF;

  IF p_success THEN
    DELETE FROM public.admin_auth_attempts
     WHERE subject_hash = p_subject_hash;
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  INSERT INTO public.admin_auth_attempts AS attempts (
    subject_hash,
    failure_count,
    first_failure_at,
    locked_until
  ) VALUES (
    p_subject_hash,
    1,
    v_now,
    NULL
  )
  ON CONFLICT (subject_hash) DO UPDATE
  SET failure_count = CASE
        WHEN attempts.locked_until > v_now THEN attempts.failure_count
        WHEN attempts.first_failure_at <= v_now - interval '15 minutes' THEN 1
        ELSE attempts.failure_count + 1
      END,
      first_failure_at = CASE
        WHEN attempts.locked_until > v_now THEN attempts.first_failure_at
        WHEN attempts.first_failure_at <= v_now - interval '15 minutes' THEN v_now
        ELSE attempts.first_failure_at
      END,
      locked_until = CASE
        WHEN attempts.locked_until > v_now THEN attempts.locked_until
        WHEN attempts.first_failure_at <= v_now - interval '15 minutes' THEN NULL
        WHEN attempts.failure_count + 1 >= 10 THEN v_now + interval '30 minutes'
        ELSE NULL
      END
  RETURNING attempts.locked_until INTO v_locked_until;

  IF v_locked_until IS NOT NULL AND v_locked_until > v_now THEN
    RETURN QUERY SELECT
      false,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_locked_until - v_now)))::integer);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_session_validate(
  p_token_hash text,
  p_subject_hash text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p_token_hash ~ '^[0-9a-f]{64}$'
    AND p_subject_hash ~ '^[0-9a-f]{64}$'
    AND EXISTS (
      SELECT 1
      FROM public.admin_sessions AS sessions
      WHERE sessions.token_hash = p_token_hash
        AND sessions.subject_hash = p_subject_hash
        AND sessions.expires_at > statement_timestamp()
    );
$$;

CREATE OR REPLACE FUNCTION public.admin_session_revoke(
  p_token_hash text,
  p_subject_hash text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.admin_sessions
   WHERE token_hash = p_token_hash
     AND subject_hash = p_subject_hash;
$$;

REVOKE ALL ON FUNCTION public.admin_auth_check(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_auth_record(text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_session_validate(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_session_revoke(text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_auth_check(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_auth_record(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_session_validate(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_session_revoke(text, text) TO service_role;

COMMIT;

