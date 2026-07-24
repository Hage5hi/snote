BEGIN;

-- Serialize the security boundary change with other release migrations. The
-- only safe rollback is API read-only; this migration must never recreate a
-- public notes policy or direct-table grant.
SELECT pg_advisory_xact_lock(20260724000000);

-- Drop every policy, including an unexpectedly renamed permissive policy. A
-- name allowlist is not a sufficient security boundary during the cutover.
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT p.polname
    FROM pg_catalog.pg_policy AS p
    JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'notes'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.notes', v_policy.polname);
  END LOOP;
END;
$$;

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

-- Browser clients have no direct table access after this point. Edge
-- Functions use service_role and expose only exact-match legacy reads or
-- capability-hash RPCs.
REVOKE ALL ON TABLE public.notes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.note_shares FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.note_capabilities FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.note_updates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.note_checkpoints FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.note_updates_seq_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.legacy_share_rotate(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Operational rollback is API read-only:
--   SELECT public.capability_runtime_set(false, false);
-- Mutating RPCs then return writes_disabled, which Edge maps to HTTP 503.
-- The existing capability predicate reads the same runtime control for sends.
DROP POLICY IF EXISTS "Snote editors can send private messages" ON realtime.messages;
CREATE POLICY "Snote editors can send private messages"
ON realtime.messages
FOR INSERT TO authenticated
WITH CHECK (
  extension IN ('broadcast', 'presence')
  AND (SELECT realtime.topic()) = 'note:' || ((SELECT auth.jwt()) ->> 'note_id')
  AND public.realtime_capability_allows(
    (SELECT auth.uid()),
    ((SELECT auth.jwt()) ->> 'note_id')::uuid,
    ((SELECT auth.jwt()) ->> 'capability_generation')::bigint,
    (SELECT auth.jwt()) ->> 'note_scope',
    true
  )
);

-- A secure duplicate must never commit an empty note before its initial state.
-- This single RPC validates the payload then atomically inserts the note,
-- capability hashes, and initial checkpoint. Any exception rolls all of it
-- back, and raw capability tokens exist only in the Edge process/client.
CREATE OR REPLACE FUNCTION public.capability_note_import_legacy(
  p_slug text,
  p_owner_token_hash text,
  p_edit_token_hash text,
  p_view_token_hash text,
  p_checkpoint_id text,
  p_payload_text text,
  p_is_encrypted boolean,
  p_salt text,
  p_check text,
  p_iterations integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_note_id uuid;
  v_standard text;
  v_payload bytea;
  v_encryption_version bigint := CASE WHEN p_is_encrypted THEN 1 ELSE 0 END;
  v_recovered boolean := false;
  v_result jsonb;
BEGIN
  IF NOT public.capability_writes_enabled() THEN
    RETURN jsonb_build_object('status', 'writes_disabled');
  END IF;

  IF p_slug IS NULL OR p_slug !~ '^[a-zA-Z0-9_-]{1,64}$'
    OR p_owner_token_hash IS NULL OR p_owner_token_hash !~ '^[a-f0-9]{64}$'
    OR p_edit_token_hash IS NULL OR p_edit_token_hash !~ '^[a-f0-9]{64}$'
    OR p_view_token_hash IS NULL OR p_view_token_hash !~ '^[a-f0-9]{64}$'
    OR p_owner_token_hash IN (p_edit_token_hash, p_view_token_hash)
    OR p_edit_token_hash = p_view_token_hash
    OR p_checkpoint_id IS NULL OR p_checkpoint_id !~ '^[a-f0-9]{64}$'
    OR p_payload_text IS NULL OR p_payload_text !~ '^[A-Za-z0-9_-]+$'
    OR p_is_encrypted IS NULL
    OR (
      p_is_encrypted AND (
        p_salt IS NULL OR length(p_salt) NOT BETWEEN 16 AND 512
        OR p_check IS NULL OR length(p_check) NOT BETWEEN 16 AND 2048
        OR p_iterations NOT BETWEEN 100000 AND 2000000
      )
    )
    OR (
      NOT p_is_encrypted
      AND (p_salt IS NOT NULL OR p_check IS NOT NULL OR p_iterations IS NOT NULL)
    )
  THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  BEGIN
    v_standard := translate(p_payload_text, '-_', '+/');
    v_payload := decode(
      v_standard || repeat('=', (4 - length(v_standard) % 4) % 4),
      'base64'
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'invalid');
  END;
  IF octet_length(v_payload) NOT BETWEEN 1 AND 1048576
    OR translate(
      rtrim(replace(replace(encode(v_payload, 'base64'), E'\n', ''), E'\r', ''), '='),
      '+/',
      '-_'
    ) <> p_payload_text
    OR encode(extensions.digest(v_payload, 'sha256'), 'hex') <> p_checkpoint_id
  THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  BEGIN
    INSERT INTO public.notes (
      slug,
      capability_managed,
      sync_status,
      content,
      ydoc_state,
      is_encrypted,
      enc_salt,
      enc_check,
      enc_iterations,
      encryption_version
    ) VALUES (
      p_slug,
      true,
      'active',
      '',
      '',
      p_is_encrypted,
      CASE WHEN p_is_encrypted THEN p_salt ELSE NULL END,
      CASE WHEN p_is_encrypted THEN p_check ELSE NULL END,
      CASE WHEN p_is_encrypted THEN p_iterations ELSE 100000 END,
      v_encryption_version
    )
    RETURNING note_id INTO v_note_id;
  EXCEPTION WHEN unique_violation THEN
    -- A client that lost the first response still owns its persisted candidate.
    -- Recover only the exact owner + immutable initial checkpoint; a different
    -- caller or different import remains a normal slug conflict.
    SELECT n.note_id INTO v_note_id
    FROM public.notes AS n
    JOIN public.note_capabilities AS owner_capability
      ON owner_capability.note_id = n.note_id
      AND owner_capability.scope = 'owner'
      AND owner_capability.token_hash = p_owner_token_hash
      AND owner_capability.revoked_at IS NULL
    JOIN public.note_checkpoints AS initial_checkpoint
      ON initial_checkpoint.note_id = n.note_id
      AND initial_checkpoint.version = 1
      AND initial_checkpoint.through_seq = 0
      AND initial_checkpoint.checkpoint_id = p_checkpoint_id
      AND initial_checkpoint.payload = v_payload
    WHERE n.slug = p_slug
      AND n.capability_managed
      AND n.deleted_at IS NULL
      AND n.sync_status <> 'deleted';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'slug_unavailable');
    END IF;
    v_recovered := true;
  END;

  IF NOT v_recovered THEN
    INSERT INTO public.note_capabilities(note_id, scope, token_hash)
    VALUES
      (v_note_id, 'owner', p_owner_token_hash),
      (v_note_id, 'edit', p_edit_token_hash),
      (v_note_id, 'view', p_view_token_hash);

    INSERT INTO public.note_checkpoints(
      note_id,
      version,
      through_seq,
      checkpoint_id,
      payload,
      encryption_version
    ) VALUES (
      v_note_id,
      1,
      0,
      p_checkpoint_id,
      v_payload,
      v_encryption_version
    );
  END IF;

  SELECT public.capability_session_open(p_owner_token_hash, 0, 200)
  INTO v_result;
  IF v_result ->> 'status' <> 'ok' THEN
    RAISE EXCEPTION 'legacy capability import unavailable';
  END IF;
  RETURN v_result || jsonb_build_object(
    'noteId', v_note_id,
    'recovered', v_recovered
  );
END;
$$;

REVOKE ALL ON FUNCTION public.capability_note_import_legacy(
  text, text, text, text, text, text, boolean, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capability_note_import_legacy(
  text, text, text, text, text, text, boolean, text, text, integer
) TO service_role;

COMMENT ON TABLE public.notes IS
  'Direct client access revoked at capability cutover. Roll back to API read-only only; never restore public policies.';

COMMIT;
