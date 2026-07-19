-- Immediate containment. Apply only after a verified PITR/backup checkpoint and
-- after 20260522000000_admin_rate_limit.sql. Edge consumers must be deployed
-- only after this migration succeeds.
-- CUTOVER SAFETY: Disable or tombstone the legacy admin and cleanup Edge endpoints before applying this migration.
-- Their baseline limiter still queries the old `ip` column and fails open when
-- that query errors; do not leave those bundles reachable while this migration
-- renames the column to `subject_hash`.

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
ALTER TABLE public.admin_auth_attempts
  ADD CONSTRAINT admin_auth_attempts_subject_hash_format
  CHECK (subject_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.admin_auth_attempts
  ADD COLUMN lease_id text,
  ADD COLUMN lease_until timestamptz,
  ADD CONSTRAINT admin_auth_attempts_lease_id_format
    CHECK (lease_id IS NULL OR lease_id ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT admin_auth_attempts_lease_pair
    CHECK ((lease_id IS NULL) = (lease_until IS NULL));
COMMENT ON COLUMN public.admin_auth_attempts.subject_hash IS
  'HMAC-SHA-256 of the gateway-verified client address; never a raw IP';
COMMENT ON COLUMN public.admin_auth_attempts.lease_id IS
  'Random single-use admission lease; permits at most one bcrypt verification per subject';

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

-- A singleton credential epoch binds password verification to session issue.
-- It is independent of admin_config so the environment-passphrase fallback is
-- also invalidated by the first database-backed rotation.
CREATE TABLE IF NOT EXISTS public.admin_auth_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  credential_epoch bigint NOT NULL DEFAULT 1 CHECK (credential_epoch > 0),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
INSERT INTO public.admin_auth_state (id, credential_epoch)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.admin_auth_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_auth_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.admin_auth_state TO service_role;

-- Read the persisted password material (or NULL for the environment fallback)
-- and its epoch from one MVCC snapshot. Separate reads would let rotation pair
-- an old fallback-password verification with the new epoch.
CREATE OR REPLACE FUNCTION public.admin_credential_material()
RETURNS TABLE(pass_hash text, credential_epoch bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT config.pass_hash, state.credential_epoch
    FROM public.admin_auth_state AS state
    LEFT JOIN public.admin_config AS config ON config.id = 1
   WHERE state.id = 1;
$$;

-- Atomically reserve the one bcrypt verification slot for a subject. A short
-- lease recovers automatically if an Edge invocation dies before completion.
CREATE OR REPLACE FUNCTION public.admin_auth_begin(
  p_subject_hash text,
  p_lease_id text
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_locked_until timestamptz;
  v_lease_until timestamptz;
  v_blocked_until timestamptz;
  v_now timestamptz := statement_timestamp();
BEGIN
  IF p_subject_hash IS NULL OR p_subject_hash !~ '^[0-9a-f]{64}$'
     OR p_lease_id IS NULL OR p_lease_id !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT false, 1800;
    RETURN;
  END IF;

  INSERT INTO public.admin_auth_attempts AS attempts (
    subject_hash,
    failure_count,
    first_failure_at,
    locked_until,
    lease_id,
    lease_until
  ) VALUES (
    p_subject_hash,
    0,
    v_now,
    NULL,
    p_lease_id,
    v_now + interval '30 seconds'
  )
  ON CONFLICT (subject_hash) DO UPDATE
  SET failure_count = CASE
        WHEN attempts.first_failure_at <= v_now - interval '15 minutes' THEN 0
        ELSE attempts.failure_count
      END,
      first_failure_at = CASE
        WHEN attempts.first_failure_at <= v_now - interval '15 minutes' THEN v_now
        ELSE attempts.first_failure_at
      END,
      locked_until = CASE
        WHEN attempts.locked_until <= v_now THEN NULL
        ELSE attempts.locked_until
      END,
      lease_id = p_lease_id,
      lease_until = v_now + interval '30 seconds'
  WHERE (attempts.locked_until IS NULL OR attempts.locked_until <= v_now)
    AND (attempts.lease_until IS NULL OR attempts.lease_until <= v_now)
  RETURNING attempts.locked_until, attempts.lease_until
    INTO v_locked_until, v_lease_until;

  IF FOUND THEN
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  SELECT attempts.locked_until, attempts.lease_until
    INTO v_locked_until, v_lease_until
    FROM public.admin_auth_attempts AS attempts
   WHERE attempts.subject_hash = p_subject_hash;

  v_blocked_until := GREATEST(
    COALESCE(v_locked_until, v_now),
    COALESCE(v_lease_until, v_now)
  );
  RETURN QUERY SELECT
    false,
    LEAST(
      1800,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_blocked_until - v_now)))::integer)
    );
END;
$$;

-- Complete exactly the active lease under a row lock. No correct result can
-- erase concurrent failures because another verification cannot be admitted
-- until this lease is cleared or expires.
CREATE OR REPLACE FUNCTION public.admin_auth_complete(
  p_subject_hash text,
  p_lease_id text,
  p_success boolean
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_failure_count integer;
  v_first_failure_at timestamptz;
  v_lease_until timestamptz;
  v_locked_until timestamptz;
  v_now timestamptz := statement_timestamp();
BEGIN
  IF p_subject_hash IS NULL OR p_subject_hash !~ '^[0-9a-f]{64}$'
     OR p_lease_id IS NULL OR p_lease_id !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'admin auth lease unavailable';
  END IF;

  SELECT attempts.failure_count, attempts.first_failure_at, attempts.lease_until
    INTO v_failure_count, v_first_failure_at, v_lease_until
    FROM public.admin_auth_attempts AS attempts
   WHERE subject_hash = p_subject_hash
     AND lease_id = p_lease_id
   FOR UPDATE;

  IF NOT FOUND OR v_lease_until IS NULL OR v_lease_until <= v_now THEN
    RAISE EXCEPTION 'admin auth lease unavailable';
  END IF;

  IF p_success THEN
    DELETE FROM public.admin_auth_attempts
     WHERE subject_hash = p_subject_hash
       AND lease_id = p_lease_id;
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  IF v_first_failure_at <= v_now - interval '15 minutes' THEN
    v_failure_count := 1;
    v_first_failure_at := v_now;
  ELSE
    v_failure_count := v_failure_count + 1;
  END IF;
  v_locked_until := CASE
    WHEN v_failure_count >= 10 THEN v_now + interval '30 minutes'
    ELSE NULL
  END;

  UPDATE public.admin_auth_attempts
     SET failure_count = v_failure_count,
         first_failure_at = v_first_failure_at,
         locked_until = v_locked_until,
         lease_id = NULL,
         lease_until = NULL
   WHERE subject_hash = p_subject_hash
     AND lease_id = p_lease_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin auth lease unavailable';
  END IF;

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

-- Session creation and password rotation lock the same singleton row. If
-- issuance wins, a later rotation deletes the new session; if rotation wins,
-- the stale verified epoch cannot issue anything.
CREATE OR REPLACE FUNCTION public.admin_session_issue(
  p_token_hash text,
  p_subject_hash text,
  p_expires_at timestamptz,
  p_credential_epoch bigint
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_credential_epoch bigint;
  v_now timestamptz := statement_timestamp();
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_subject_hash IS NULL OR p_subject_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL OR p_expires_at <= v_now
     OR p_expires_at > v_now + interval '30 minutes'
     OR p_credential_epoch IS NULL OR p_credential_epoch < 1 THEN
    RAISE EXCEPTION 'admin session issue unavailable';
  END IF;

  SELECT state.credential_epoch
    INTO v_credential_epoch
    FROM public.admin_auth_state AS state
   WHERE state.id = 1
   FOR UPDATE;

  IF NOT FOUND OR v_credential_epoch <> p_credential_epoch THEN
    RAISE EXCEPTION 'admin session issue unavailable';
  END IF;

  INSERT INTO public.admin_sessions (token_hash, subject_hash, expires_at)
  VALUES (p_token_hash, p_subject_hash, p_expires_at);
END;
$$;

-- Rotate the persisted pass hash and revoke every outstanding session in one
-- database transaction. The caller's session is intentionally revoked too,
-- forcing a fresh exchange with the new passphrase.
DROP FUNCTION IF EXISTS public.admin_pass_rotate(text);
CREATE OR REPLACE FUNCTION public.admin_pass_rotate(
  p_pass_hash text,
  p_token_hash text,
  p_subject_hash text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_consumed_token_hash text;
  v_credential_epoch bigint;
BEGIN
  IF p_pass_hash IS NULL
     OR p_pass_hash !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$'
     OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_subject_hash IS NULL OR p_subject_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'admin pass rotation unavailable';
  END IF;

  -- Serialize against session issuance and other rotations before consuming
  -- the caller. This avoids both old-password login minting and rotate/rotate
  -- last-writer-wins races.
  SELECT state.credential_epoch
    INTO v_credential_epoch
    FROM public.admin_auth_state AS state
   WHERE state.id = 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin pass rotation unavailable';
  END IF;

  -- DELETE takes a row lock. Exactly one concurrent caller can consume this
  -- live session; a stale or already-consumed request fails before any hash
  -- update occurs.
  DELETE FROM public.admin_sessions
   WHERE token_hash = p_token_hash
     AND subject_hash = p_subject_hash
     AND expires_at > statement_timestamp()
  RETURNING token_hash INTO v_consumed_token_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin pass rotation unavailable';
  END IF;

  INSERT INTO public.admin_config (id, pass_hash, updated_at)
  VALUES (1, p_pass_hash, statement_timestamp())
  ON CONFLICT (id) DO UPDATE
    SET pass_hash = EXCLUDED.pass_hash,
        updated_at = EXCLUDED.updated_at;

  UPDATE public.admin_auth_state
     SET credential_epoch = credential_epoch + 1,
         updated_at = statement_timestamp()
   WHERE id = 1;

  DELETE FROM public.admin_sessions;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_auth_check(text);
DROP FUNCTION IF EXISTS public.admin_auth_record(text, boolean);

REVOKE ALL ON FUNCTION public.admin_auth_begin(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_auth_complete(text, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_credential_material()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_session_validate(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_session_revoke(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_session_issue(text, text, timestamptz, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_pass_rotate(text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_auth_begin(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_auth_complete(text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_credential_material() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_session_validate(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_session_revoke(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_session_issue(text, text, timestamptz, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_pass_rotate(text, text, text) TO service_role;

COMMIT;
