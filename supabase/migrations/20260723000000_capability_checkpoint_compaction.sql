-- Edit-scoped, compare-and-swap checkpoint compaction for capability notes.
BEGIN;

CREATE OR REPLACE FUNCTION public.capability_checkpoint_append(
  p_token_hash text,
  p_checkpoint jsonb,
  p_expected_checkpoint_version bigint,
  p_expected_encryption_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_note record;
  v_checkpoint_id text;
  v_payload_text text;
  v_standard text;
  v_payload bytea;
  v_through_seq bigint;
  v_current_seq bigint;
  v_latest_version bigint;
  v_latest_through_seq bigint;
  v_next_version bigint;
BEGIN
  IF NOT public.capability_writes_enabled() THEN
    RETURN jsonb_build_object('status', 'writes_disabled');
  END IF;

  IF p_token_hash !~ '^[a-f0-9]{64}$'
    OR p_checkpoint IS NULL
    OR jsonb_typeof(p_checkpoint) <> 'object'
    OR p_expected_checkpoint_version IS NULL
    OR p_expected_checkpoint_version < 0
    OR p_expected_encryption_version IS NULL
    OR p_expected_encryption_version < 0
  THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT
    n.note_id,
    n.sync_status,
    n.encryption_version,
    n.payload_limit_bytes,
    n.storage_limit_bytes,
    n.checkpoint_limit_count
  INTO v_note
  FROM public.note_capabilities AS c
  JOIN public.notes AS n ON n.note_id = c.note_id
  WHERE c.token_hash = p_token_hash
    AND c.scope IN ('owner', 'edit')
    AND c.revoked_at IS NULL
    AND n.capability_managed
  FOR UPDATE OF n;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;
  IF v_note.sync_status <> 'active' THEN
    RETURN jsonb_build_object('status', 'read_only');
  END IF;
  IF v_note.encryption_version <> p_expected_encryption_version THEN
    RETURN jsonb_build_object('status', 'version_conflict');
  END IF;

  SELECT COALESCE(MAX(version), 0), COALESCE(MAX(through_seq), 0)
  INTO v_latest_version, v_latest_through_seq
  FROM public.note_checkpoints
  WHERE note_id = v_note.note_id;
  IF v_latest_version <> p_expected_checkpoint_version THEN
    RETURN jsonb_build_object('status', 'version_conflict');
  END IF;

  BEGIN
    v_checkpoint_id := p_checkpoint ->> 'checkpointId';
    v_payload_text := p_checkpoint ->> 'payload';
    v_through_seq := (p_checkpoint ->> 'throughSequence')::bigint;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'invalid');
  END;

  SELECT COALESCE(MAX(seq), 0)
  INTO v_current_seq
  FROM public.note_updates
  WHERE note_id = v_note.note_id;
  IF v_checkpoint_id IS NULL
    OR v_payload_text IS NULL
    OR v_through_seq IS NULL
    OR v_checkpoint_id !~ '^[a-f0-9]{64}$'
    OR v_payload_text !~ '^[A-Za-z0-9_-]+$'
    OR v_through_seq <= v_latest_through_seq
    OR v_through_seq > v_current_seq
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
    OR encode(extensions.digest(v_payload, 'sha256'), 'hex') <> v_checkpoint_id
    OR translate(
      rtrim(replace(replace(encode(v_payload, 'base64'), E'\n', ''), E'\r', ''), '='),
      '+/', '-_'
    ) <> v_payload_text
  THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF (
    SELECT count(*) >= v_note.checkpoint_limit_count
    FROM public.note_checkpoints
    WHERE note_id = v_note.note_id
  ) OR (
    SELECT
      COALESCE((SELECT sum(octet_length(payload)) FROM public.note_updates
        WHERE note_id = v_note.note_id), 0)
      + COALESCE((SELECT sum(octet_length(payload)) FROM public.note_checkpoints
        WHERE note_id = v_note.note_id), 0)
      + octet_length(v_payload) > v_note.storage_limit_bytes
  ) THEN
    UPDATE public.notes
    SET sync_status = 'read_only_quarantine'
    WHERE note_id = v_note.note_id;
    RETURN jsonb_build_object('status', 'quota_exceeded');
  END IF;

  v_next_version := v_latest_version + 1;
  INSERT INTO public.note_checkpoints(
    note_id,
    version,
    through_seq,
    checkpoint_id,
    payload,
    encryption_version
  ) VALUES (
    v_note.note_id,
    v_next_version,
    v_through_seq,
    v_checkpoint_id,
    v_payload,
    v_note.encryption_version
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'noteId', v_note.note_id,
    'checkpointVersion', v_next_version,
    'throughSequence', v_through_seq
  );
END;
$$;

REVOKE ALL ON FUNCTION public.capability_checkpoint_append(text, jsonb, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capability_checkpoint_append(text, jsonb, bigint, bigint)
  TO service_role;

COMMIT;
