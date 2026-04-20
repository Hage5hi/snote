-- Add tags column for lightweight categorization
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- Index for filtering by tag in admin panel
CREATE INDEX IF NOT EXISTS idx_notes_tags ON public.notes USING GIN(tags);