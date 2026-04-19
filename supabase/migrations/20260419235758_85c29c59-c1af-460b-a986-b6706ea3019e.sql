ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS is_encrypted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enc_salt text,
  ADD COLUMN IF NOT EXISTS enc_check text;

CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON public.notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_empty ON public.notes(created_at) WHERE char_count = 0;