-- Public read-only share links.
--
-- The `notes` table is world-writable by slug (anyone who knows a slug can
-- edit). To offer a "read-only" share we must therefore hand out something
-- that is NOT the slug. Each share link is a random token that maps to a
-- slug server-side; the slug is never sent back to the viewer.
--
-- RLS intentionally has NO public policies on this table. All access goes
-- through the `share-create` / `share-view` / `share-revoke` Edge functions,
-- which run with the service role and bypass RLS. A curious reader querying
-- `/rest/v1/note_shares?token=eq.xxx` with the publishable key will get
-- nothing back, so the slug stays hidden.

CREATE TABLE public.note_shares (
  token TEXT PRIMARY KEY,
  -- UNIQUE on slug enforces the "one link per slug" contract at the DB
  -- level. Without it, two concurrent share-create calls could race past
  -- the DELETE and leave two active tokens, one of which would be
  -- orphaned (not in localStorage, not revokable from the UI).
  slug TEXT NOT NULL UNIQUE REFERENCES public.notes(slug) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.note_shares
  ADD CONSTRAINT note_shares_token_format CHECK (token ~ '^[A-Za-z0-9_-]{16,64}$');

-- UNIQUE already creates an index on slug, so no explicit CREATE INDEX.

ALTER TABLE public.note_shares ENABLE ROW LEVEL SECURITY;
-- No policies. Deny-by-default. Access only via Edge functions.
