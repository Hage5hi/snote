ALTER TABLE public.notes
ADD COLUMN enc_iterations integer NOT NULL DEFAULT 100000;