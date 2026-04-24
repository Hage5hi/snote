-- Add per-note PBKDF2 iteration count so we can bump the default without
-- breaking existing encrypted notes. NULL means legacy (pre-migration)
-- notes, which were all derived with 100_000 iterations.
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS enc_iterations INT;
