-- Create note_shares table for read-only share links.
-- Token maps to slug server-side; viewer never learns the slug.
-- All access via Edge functions (service role); RLS deny-all (no policies).

CREATE TABLE IF NOT EXISTS public.note_shares (
  token TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE REFERENCES public.notes(slug) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CHECK constraint with idempotent guard (ALTER TABLE doesn't support
-- IF NOT EXISTS for constraints).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'note_shares_token_format'
      AND conrelid = 'public.note_shares'::regclass
  ) THEN
    ALTER TABLE public.note_shares
      ADD CONSTRAINT note_shares_token_format
      CHECK (token ~ '^[A-Za-z0-9_-]{16,64}$');
  END IF;
END $$;

ALTER TABLE public.note_shares ENABLE ROW LEVEL SECURITY;
-- No policies. Deny-by-default. Access only via share-* Edge functions
-- using SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.