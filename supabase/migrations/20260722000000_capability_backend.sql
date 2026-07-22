-- Capability backend (additive phase).
--
-- Legacy rows intentionally receive a note_id but no capability. This avoids
-- the unsafe "first visitor becomes owner" pattern. Secure rows are hidden
-- from the temporary legacy policies until the atomic direct-table cutover.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
  CREATE TYPE public.note_capability_scope AS ENUM ('owner', 'edit', 'view');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.note_sync_status AS ENUM (
    'legacy',
    'active',
    'read_only_quarantine',
    'deleted'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS note_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS capability_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_status public.note_sync_status NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS encryption_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payload_limit_bytes integer NOT NULL DEFAULT 1048576,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS notes_note_id_key ON public.notes(note_id);

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_payload_limit_valid,
  ADD CONSTRAINT notes_payload_limit_valid
    CHECK (payload_limit_bytes BETWEEN 65536 AND 4194304),
  DROP CONSTRAINT IF EXISTS notes_encryption_version_valid,
  ADD CONSTRAINT notes_encryption_version_valid CHECK (encryption_version >= 0),
  DROP CONSTRAINT IF EXISTS notes_encryption_metadata_consistent,
  ADD CONSTRAINT notes_encryption_metadata_consistent CHECK (
    NOT capability_managed
    OR (
      is_encrypted
      AND enc_salt IS NOT NULL
      AND length(enc_salt) BETWEEN 16 AND 512
      AND enc_check IS NOT NULL
      AND length(enc_check) BETWEEN 16 AND 2048
      AND enc_iterations BETWEEN 100000 AND 2000000
    )
    OR (
      NOT is_encrypted
      AND enc_salt IS NULL
      AND enc_check IS NULL
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.enforce_note_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.note_id IS DISTINCT FROM OLD.note_id THEN
    RAISE EXCEPTION 'note identity is immutable' USING ERRCODE = '22023';
  END IF;
  IF OLD.capability_managed AND NOT NEW.capability_managed THEN
    RAISE EXCEPTION 'capability ownership cannot be removed' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notes_immutable_identity ON public.notes;
CREATE TRIGGER notes_immutable_identity
  BEFORE UPDATE OF note_id, capability_managed ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_note_identity();

-- During the additive/dual-mode phase, old clients may continue to use only
-- legacy rows. Capability-managed rows are never visible or writable through
-- the public notes table. PR5 removes these policies and grants atomically.
DROP POLICY IF EXISTS "Anyone can read notes" ON public.notes;
DROP POLICY IF EXISTS "Anyone can create notes" ON public.notes;
DROP POLICY IF EXISTS "Anyone can update notes" ON public.notes;
DROP POLICY IF EXISTS "Legacy notes remain readable" ON public.notes;
DROP POLICY IF EXISTS "Legacy notes remain creatable" ON public.notes;
DROP POLICY IF EXISTS "Legacy notes remain writable" ON public.notes;

CREATE POLICY "Legacy notes remain readable"
  ON public.notes FOR SELECT TO anon, authenticated
  USING (NOT capability_managed);

CREATE POLICY "Legacy notes remain creatable"
  ON public.notes FOR INSERT TO anon, authenticated
  WITH CHECK (NOT capability_managed AND sync_status = 'legacy');

CREATE POLICY "Legacy notes remain writable"
  ON public.notes FOR UPDATE TO anon, authenticated
  USING (NOT capability_managed)
  WITH CHECK (NOT capability_managed AND sync_status = 'legacy');

-- Legacy share creation runs with the service role. Keep both the old deployed
-- bundle and the replacement RPC from ever attaching a slug FK to a secure
-- note: such a row would otherwise let an unauthenticated caller block owner
-- rename. The row lock also serializes target deletion/rename with creation.
CREATE OR REPLACE FUNCTION public.enforce_legacy_share_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM 1
  FROM public.notes AS n
  WHERE n.slug = NEW.slug
    AND NOT n.capability_managed
    AND n.sync_status = 'legacy'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'legacy share target unavailable'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS note_shares_legacy_targets_only ON public.note_shares;
CREATE TRIGGER note_shares_legacy_targets_only
  BEFORE INSERT OR UPDATE OF slug ON public.note_shares
  FOR EACH ROW EXECUTE FUNCTION public.enforce_legacy_share_target();

CREATE OR REPLACE FUNCTION public.legacy_share_rotate(
  p_slug text,
  p_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-zA-Z0-9_-]{1,64}$'
    OR p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{16,64}$'
  THEN
    RETURN false;
  END IF;

  INSERT INTO public.notes(slug)
  VALUES (p_slug)
  ON CONFLICT (slug) DO NOTHING;

  PERFORM 1
  FROM public.notes AS n
  WHERE n.slug = p_slug
    AND NOT n.capability_managed
    AND n.sync_status = 'legacy'
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.note_shares(token, slug, created_at)
  VALUES (p_token, p_slug, statement_timestamp())
  ON CONFLICT (slug) DO UPDATE
  SET token = EXCLUDED.token,
      created_at = EXCLUDED.created_at;
  RETURN true;
END;
$$;

CREATE TABLE public.note_capabilities (
  capability_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.notes(note_id) ON DELETE CASCADE,
  scope public.note_capability_scope NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (note_id, scope, generation)
);

CREATE UNIQUE INDEX note_capabilities_one_active_scope
  ON public.note_capabilities(note_id, scope)
  WHERE revoked_at IS NULL;
CREATE INDEX note_capabilities_active_lookup
  ON public.note_capabilities(token_hash)
  WHERE revoked_at IS NULL;

CREATE TABLE public.note_updates (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note_id uuid NOT NULL REFERENCES public.notes(note_id) ON DELETE CASCADE,
  update_id text NOT NULL CHECK (update_id ~ '^[a-f0-9]{64}$'),
  payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 4194304),
  encryption_version bigint NOT NULL CHECK (encryption_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, update_id)
);

CREATE INDEX note_updates_note_sequence ON public.note_updates(note_id, seq);

CREATE TABLE public.note_checkpoints (
  note_id uuid NOT NULL REFERENCES public.notes(note_id) ON DELETE CASCADE,
  version bigint NOT NULL CHECK (version >= 1),
  through_seq bigint NOT NULL CHECK (through_seq >= 0),
  checkpoint_id text NOT NULL CHECK (checkpoint_id ~ '^[a-f0-9]{64}$'),
  payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 4194304),
  encryption_version bigint NOT NULL CHECK (encryption_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, version)
);

CREATE OR REPLACE FUNCTION public.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- UPDATE and direct child-row DELETE are forbidden. A database-authorized
  -- deletion of the parent note may cascade so user/admin deletion actually
  -- erases the note's opaque history instead of leaving orphaned content.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'append-only relation cannot be mutated' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS note_updates_append_only ON public.note_updates;
CREATE TRIGGER note_updates_append_only
  BEFORE UPDATE OR DELETE ON public.note_updates
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

DROP TRIGGER IF EXISTS note_checkpoints_append_only ON public.note_checkpoints;
CREATE TRIGGER note_checkpoints_append_only
  BEFORE UPDATE OR DELETE ON public.note_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

ALTER TABLE public.note_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_checkpoints ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.note_capabilities FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.note_updates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.note_checkpoints FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.note_updates_seq_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.capability_note_create(
  p_slug text,
  p_owner_token_hash text,
  p_edit_token_hash text,
  p_view_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_note_id uuid;
  v_result jsonb;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-zA-Z0-9_-]{1,64}$'
    OR p_owner_token_hash IS NULL OR p_owner_token_hash !~ '^[a-f0-9]{64}$'
    OR p_edit_token_hash IS NULL OR p_edit_token_hash !~ '^[a-f0-9]{64}$'
    OR p_view_token_hash IS NULL OR p_view_token_hash !~ '^[a-f0-9]{64}$'
    OR p_owner_token_hash IN (p_edit_token_hash, p_view_token_hash)
    OR p_edit_token_hash = p_view_token_hash
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
      encryption_version
    ) VALUES (
      p_slug,
      true,
      'active',
      '',
      '',
      false,
      NULL,
      NULL,
      0
    )
    RETURNING note_id INTO v_note_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'slug_unavailable');
  END;

  INSERT INTO public.note_capabilities(note_id, scope, token_hash)
  VALUES
    (v_note_id, 'owner', p_owner_token_hash),
    (v_note_id, 'edit', p_edit_token_hash),
    (v_note_id, 'view', p_view_token_hash);

  -- Opening inside the same RPC means an internal failure rolls creation back;
  -- the Edge layer never commits a note before it can return the raw owner key.
  SELECT public.capability_session_open(p_owner_token_hash, 0, 200)
  INTO v_result;
  IF v_result ->> 'status' <> 'ok' THEN
    RAISE EXCEPTION 'capability note creation unavailable';
  END IF;
  RETURN v_result || jsonb_build_object('noteId', v_note_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.capability_session_open(
  p_token_hash text,
  p_after_seq bigint DEFAULT 0,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_capability_id uuid;
  v_session jsonb;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
    OR p_after_seq < 0
    OR p_limit NOT BETWEEN 1 AND 500
  THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- One SQL statement gives metadata, checkpoint, sequence, and updates the
  -- same READ COMMITTED statement snapshot. It cannot mix plaintext metadata
  -- with a newly committed ciphertext checkpoint (or mismatched update bounds).
  WITH capability AS MATERIALIZED (
    SELECT
      c.capability_id,
      c.note_id,
      c.scope,
      c.generation,
      n.slug,
      n.sync_status,
      n.is_encrypted,
      n.enc_salt,
      n.enc_check,
      n.enc_iterations,
      n.encryption_version,
      n.payload_limit_bytes
    FROM public.note_capabilities AS c
    JOIN public.notes AS n ON n.note_id = c.note_id
    WHERE c.token_hash = p_token_hash
      AND c.revoked_at IS NULL
      AND n.capability_managed
      AND n.deleted_at IS NULL
      AND n.sync_status <> 'deleted'
  )
  SELECT
    c.capability_id,
    jsonb_build_object(
      'capabilityId', c.capability_id,
      'noteId', c.note_id,
      'slug', c.slug,
      'scope', c.scope,
      'generation', c.generation,
      'syncStatus', c.sync_status,
      'currentSequence', (
        SELECT COALESCE(MAX(u.seq), 0)
        FROM public.note_updates AS u
        WHERE u.note_id = c.note_id
      ),
      'payloadLimitBytes', c.payload_limit_bytes,
      'checkpointSequence', COALESCE(cp.through_seq, 0),
      'checkpointVersion', cp.version,
      'checkpointPayload', cp.payload,
      'checkpointEncryptionVersion', cp.encryption_version,
      'missingUpdates', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'updateId', selected.update_id,
            'payload', selected.payload,
            'sequence', selected.seq,
            'encryptionVersion', selected.encryption_version
          ) ORDER BY selected.seq
        ), '[]'::jsonb)
        FROM (
          SELECT
            u.update_id,
            replace(replace(encode(u.payload, 'base64'), E'\n', ''), E'\r', '') AS payload,
            u.seq,
            u.encryption_version
          FROM public.note_updates AS u
          WHERE u.note_id = c.note_id
            AND u.seq > GREATEST(p_after_seq, COALESCE(cp.through_seq, 0))
          ORDER BY u.seq
          LIMIT p_limit
        ) AS selected
      ),
      'encryption', jsonb_build_object(
        'enabled', c.is_encrypted,
        'version', c.encryption_version,
        'salt', c.enc_salt,
        'check', c.enc_check,
        'iterations', c.enc_iterations
      )
    )
  INTO v_capability_id, v_session
  FROM capability AS c
  LEFT JOIN LATERAL (
    SELECT
      checkpoint.version,
      checkpoint.through_seq,
      replace(replace(encode(checkpoint.payload, 'base64'), E'\n', ''), E'\r', '') AS payload,
      checkpoint.encryption_version
    FROM public.note_checkpoints AS checkpoint
    WHERE checkpoint.note_id = c.note_id
    ORDER BY checkpoint.version DESC
    LIMIT 1
  ) AS cp ON true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;

  UPDATE public.note_capabilities
  SET last_used_at = now()
  WHERE capability_id = v_capability_id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'session', v_session
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.capability_updates_append(
  p_token_hash text,
  p_updates jsonb,
  p_expected_encryption_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_note record;
  v_item jsonb;
  v_update_id text;
  v_payload_text text;
  v_standard text;
  v_payload bytea;
  v_total_bytes bigint := 0;
  v_sequence bigint;
  v_acknowledgements jsonb := '[]'::jsonb;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_updates) <> 'array'
    OR jsonb_array_length(p_updates) > 100
    OR p_expected_encryption_version < 0
  THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT n.note_id, n.sync_status, n.encryption_version, n.payload_limit_bytes
  INTO v_note
  FROM public.note_capabilities AS c
  JOIN public.notes AS n ON n.note_id = c.note_id
  WHERE c.token_hash = p_token_hash
    AND c.revoked_at IS NULL
    AND c.scope IN ('owner', 'edit')
    AND n.capability_managed
    AND n.deleted_at IS NULL
  FOR SHARE OF n;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;
  IF v_note.sync_status <> 'active' THEN
    RETURN jsonb_build_object('status', 'read_only');
  END IF;
  IF v_note.encryption_version <> p_expected_encryption_version THEN
    RETURN jsonb_build_object('status', 'version_conflict');
  END IF;

  -- Validate the complete batch before the first append. Returning an error
  -- after inserting an earlier item would otherwise commit a partial batch.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_update_id := v_item ->> 'updateId';
    v_payload_text := v_item ->> 'payload';
    IF v_update_id !~ '^[a-f0-9]{64}$'
      OR v_payload_text IS NULL
      OR v_payload_text !~ '^[A-Za-z0-9_-]+$'
      OR length(v_payload_text) % 4 = 1
      OR length(v_payload_text) > ((v_note.payload_limit_bytes + 2) / 3) * 4
    THEN
      RETURN jsonb_build_object('status', 'invalid');
    END IF;

    BEGIN
      v_standard := translate(v_payload_text, '-_', '+/');
      v_payload := decode(
        v_standard || repeat('=', (4 - length(v_standard) % 4) % 4),
        'base64'
      );
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('status', 'invalid');
    END;

    IF octet_length(v_payload) NOT BETWEEN 1 AND v_note.payload_limit_bytes
      OR translate(
        rtrim(replace(replace(encode(v_payload, 'base64'), E'\n', ''), E'\r', ''), '='),
        '+/',
        '-_'
      ) <> v_payload_text
      OR encode(extensions.digest(v_payload, 'sha256'), 'hex') <> v_update_id
    THEN
      RETURN jsonb_build_object('status', 'invalid');
    END IF;

    v_total_bytes := v_total_bytes + octet_length(v_payload);
    IF v_total_bytes > 4194304 THEN
      RETURN jsonb_build_object('status', 'payload_too_large');
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_update_id := v_item ->> 'updateId';
    v_payload_text := v_item ->> 'payload';
    v_standard := translate(v_payload_text, '-_', '+/');
    v_payload := decode(
      v_standard || repeat('=', (4 - length(v_standard) % 4) % 4),
      'base64'
    );
    INSERT INTO public.note_updates(note_id, update_id, payload, encryption_version)
    VALUES (v_note.note_id, v_update_id, v_payload, v_note.encryption_version)
    ON CONFLICT (note_id, update_id) DO NOTHING
    RETURNING seq INTO v_sequence;

    IF v_sequence IS NULL THEN
      SELECT seq INTO v_sequence
      FROM public.note_updates
      WHERE note_id = v_note.note_id AND update_id = v_update_id;
    END IF;

    v_acknowledgements := v_acknowledgements || jsonb_build_array(
      jsonb_build_object('updateId', v_update_id, 'sequence', v_sequence)
    );
    v_sequence := NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok',
    'acknowledgements', v_acknowledgements
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.capability_note_manage(
  p_token_hash text,
  p_action text,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_note record;
  v_slug text;
  v_scope public.note_capability_scope;
  v_new_hash text;
  v_generation bigint;
  v_target_encrypted boolean;
  v_expected_version bigint;
  v_checkpoint jsonb;
  v_checkpoint_id text;
  v_payload_text text;
  v_standard text;
  v_payload bytea;
  v_through_seq bigint;
  v_current_seq bigint;
  v_checkpoint_version bigint;
  v_salt text;
  v_check text;
  v_iterations integer;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
    OR p_action IS NULL
    OR p_params IS NULL
    OR jsonb_typeof(p_params) <> 'object'
  THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT n.note_id, n.slug, n.sync_status, n.encryption_version, n.payload_limit_bytes
  INTO v_note
  FROM public.note_capabilities AS c
  JOIN public.notes AS n ON n.note_id = c.note_id
  WHERE c.token_hash = p_token_hash
    AND c.revoked_at IS NULL
    AND c.scope = 'owner'
    AND n.capability_managed
    AND n.deleted_at IS NULL
    AND n.sync_status <> 'deleted'
  FOR UPDATE OF n;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;

  IF p_action = 'rename' THEN
    v_slug := btrim(p_params ->> 'slug');
    IF v_slug !~ '^[a-zA-Z0-9_-]{1,64}$' THEN
      RETURN jsonb_build_object('status', 'invalid');
    END IF;
    BEGIN
      UPDATE public.notes SET slug = v_slug WHERE note_id = v_note.note_id;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('status', 'slug_unavailable');
    END;
    RETURN jsonb_build_object('status', 'ok', 'slug', v_slug);
  END IF;

  IF p_action = 'delete' THEN
    DELETE FROM public.notes WHERE note_id = v_note.note_id;
    RETURN jsonb_build_object('status', 'ok');
  END IF;

  IF p_action = 'rotate' THEN
    BEGIN
      v_scope := (p_params ->> 'scope')::public.note_capability_scope;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('status', 'invalid');
    END;
    v_new_hash := p_params ->> 'tokenHash';
    IF v_scope NOT IN ('edit', 'view') OR v_new_hash !~ '^[a-f0-9]{64}$' THEN
      RETURN jsonb_build_object('status', 'invalid');
    END IF;
    SELECT COALESCE(MAX(generation), 0) + 1 INTO v_generation
    FROM public.note_capabilities
    WHERE note_id = v_note.note_id AND scope = v_scope;
    UPDATE public.note_capabilities
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE note_id = v_note.note_id AND scope = v_scope AND revoked_at IS NULL;
    INSERT INTO public.note_capabilities(note_id, scope, token_hash, generation)
    VALUES (v_note.note_id, v_scope, v_new_hash, v_generation);
    RETURN jsonb_build_object('status', 'ok', 'scope', v_scope, 'generation', v_generation);
  END IF;

  IF p_action = 'set-encryption' THEN
    IF v_note.sync_status <> 'active' THEN
      RETURN jsonb_build_object('status', 'read_only');
    END IF;
    v_target_encrypted := (p_params ->> 'isEncrypted')::boolean;
    v_expected_version := (p_params ->> 'expectedEncryptionVersion')::bigint;
    v_checkpoint := p_params -> 'checkpoint';
    IF v_target_encrypted IS NULL
      OR v_expected_version IS DISTINCT FROM v_note.encryption_version
      OR jsonb_typeof(v_checkpoint) <> 'object'
    THEN
      RETURN jsonb_build_object('status', 'version_conflict');
    END IF;

    v_checkpoint_id := v_checkpoint ->> 'checkpointId';
    v_payload_text := v_checkpoint ->> 'payload';
    v_through_seq := (v_checkpoint ->> 'throughSequence')::bigint;
    SELECT COALESCE(MAX(seq), 0) INTO v_current_seq
    FROM public.note_updates WHERE note_id = v_note.note_id;
    IF v_checkpoint_id IS NULL
      OR v_payload_text IS NULL
      OR v_through_seq IS NULL
      OR v_checkpoint_id !~ '^[a-f0-9]{64}$'
      OR v_payload_text !~ '^[A-Za-z0-9_-]+$'
      OR v_through_seq <> v_current_seq
    THEN
      RETURN jsonb_build_object('status', 'invalid');
    END IF;

    BEGIN
      v_standard := translate(v_payload_text, '-_', '+/');
      v_payload := decode(v_standard || repeat('=', (4 - length(v_standard) % 4) % 4), 'base64');
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('status', 'invalid');
    END;
    IF octet_length(v_payload) NOT BETWEEN 1 AND v_note.payload_limit_bytes
      OR translate(
        rtrim(replace(replace(encode(v_payload, 'base64'), E'\n', ''), E'\r', ''), '='),
        '+/',
        '-_'
      ) <> v_payload_text
      OR encode(extensions.digest(v_payload, 'sha256'), 'hex') <> v_checkpoint_id
    THEN
      RETURN jsonb_build_object('status', 'invalid');
    END IF;

    v_salt := NULLIF(p_params ->> 'salt', '');
    v_check := NULLIF(p_params ->> 'check', '');
    v_iterations := COALESCE((p_params ->> 'iterations')::integer, 100000);
    IF v_target_encrypted AND (
      v_salt IS NULL
      OR v_check IS NULL
      OR length(v_salt) NOT BETWEEN 16 AND 512
      OR length(v_check) NOT BETWEEN 16 AND 2048
      OR v_iterations NOT BETWEEN 100000 AND 2000000
    ) THEN
      RETURN jsonb_build_object('status', 'invalid');
    END IF;
    IF NOT v_target_encrypted THEN
      v_salt := NULL;
      v_check := NULL;
    END IF;

    SELECT COALESCE(MAX(version), 0) + 1 INTO v_checkpoint_version
    FROM public.note_checkpoints WHERE note_id = v_note.note_id;
    INSERT INTO public.note_checkpoints(
      note_id, version, through_seq, checkpoint_id, payload, encryption_version
    ) VALUES (
      v_note.note_id,
      v_checkpoint_version,
      v_through_seq,
      v_checkpoint_id,
      v_payload,
      v_note.encryption_version + 1
    );
    UPDATE public.notes
    SET
      is_encrypted = v_target_encrypted,
      enc_salt = v_salt,
      enc_check = v_check,
      enc_iterations = v_iterations,
      encryption_version = encryption_version + 1
    WHERE note_id = v_note.note_id;
    RETURN jsonb_build_object(
      'status', 'ok',
      'encryptionVersion', v_note.encryption_version + 1,
      'checkpointVersion', v_checkpoint_version
    );
  END IF;

  RETURN jsonb_build_object('status', 'invalid');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('status', 'invalid');
END;
$$;

-- Aggregate-only sizing: no slug, content, token, or IP is returned. Staging
-- must run this before choosing a production payload limit. Oversized rows are
-- quarantined by the companion function instead of being truncated.
CREATE OR REPLACE FUNCTION public.capability_payload_audit(
  p_soft_limit integer DEFAULT 1048576
)
RETURNS TABLE (
  total_notes bigint,
  notes_above_limit bigint,
  max_legacy_snapshot_bytes bigint,
  max_update_bytes bigint,
  max_checkpoint_bytes bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
    (SELECT count(*) FROM public.notes)::bigint,
    (SELECT count(*) FROM public.notes
      WHERE GREATEST(octet_length(ydoc_state), octet_length(content)) > p_soft_limit)::bigint,
    (SELECT COALESCE(MAX(GREATEST(octet_length(ydoc_state), octet_length(content))), 0)
      FROM public.notes)::bigint,
    (SELECT COALESCE(MAX(octet_length(payload)), 0) FROM public.note_updates)::bigint,
    (SELECT COALESCE(MAX(octet_length(payload)), 0) FROM public.note_checkpoints)::bigint;
$$;

CREATE OR REPLACE FUNCTION public.capability_quarantine_oversized()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_count bigint;
BEGIN
  WITH quarantined AS (
    UPDATE public.notes AS n
    SET sync_status = 'read_only_quarantine'
    WHERE n.capability_managed
      AND n.sync_status = 'active'
      AND (
        EXISTS (
          SELECT 1 FROM public.note_updates AS u
          WHERE u.note_id = n.note_id AND octet_length(u.payload) > n.payload_limit_bytes
        )
        OR EXISTS (
          SELECT 1 FROM public.note_checkpoints AS c
          WHERE c.note_id = n.note_id AND octet_length(c.payload) > n.payload_limit_bytes
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM quarantined;
  RETURN v_count;
END;
$$;

-- Realtime policies call this narrow SECURITY DEFINER predicate because the
-- capability table itself remains deny-all to authenticated clients.
CREATE OR REPLACE FUNCTION public.realtime_capability_allows(
  p_capability_id uuid,
  p_note_id uuid,
  p_generation bigint,
  p_claim_scope text,
  p_write boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.note_capabilities AS c
    JOIN public.notes AS n ON n.note_id = c.note_id
    WHERE c.capability_id = p_capability_id
      AND c.note_id = p_note_id
      AND c.generation = p_generation
      AND c.scope::text = p_claim_scope
      AND c.revoked_at IS NULL
      AND n.capability_managed
      AND n.deleted_at IS NULL
      AND n.sync_status <> 'deleted'
      AND (NOT p_write OR (c.scope IN ('owner', 'edit') AND n.sync_status = 'active'))
  );
$$;

DROP POLICY IF EXISTS "Snote capabilities can receive private messages" ON realtime.messages;
DROP POLICY IF EXISTS "Snote editors can send private messages" ON realtime.messages;

CREATE POLICY "Snote capabilities can receive private messages"
ON realtime.messages
FOR SELECT TO authenticated
USING (
  extension IN ('broadcast', 'presence')
  AND (SELECT realtime.topic()) = 'note:' || ((SELECT auth.jwt()) ->> 'note_id')
  AND public.realtime_capability_allows(
    (SELECT auth.uid()),
    ((SELECT auth.jwt()) ->> 'note_id')::uuid,
    ((SELECT auth.jwt()) ->> 'capability_generation')::bigint,
    (SELECT auth.jwt()) ->> 'note_scope',
    false
  )
);

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

REVOKE ALL ON FUNCTION public.enforce_note_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_legacy_share_target() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.legacy_share_rotate(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_append_only_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capability_note_create(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capability_session_open(text, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capability_updates_append(text, jsonb, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capability_note_manage(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capability_payload_audit(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capability_quarantine_oversized() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.realtime_capability_allows(uuid, uuid, bigint, text, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.capability_note_create(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.legacy_share_rotate(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.capability_session_open(text, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capability_updates_append(text, jsonb, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.capability_note_manage(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.capability_payload_audit(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capability_quarantine_oversized() TO service_role;
GRANT EXECUTE ON FUNCTION public.realtime_capability_allows(uuid, uuid, bigint, text, boolean) TO authenticated;

COMMIT;
