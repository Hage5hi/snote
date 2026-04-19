
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.generate_tracking_id() CASCADE;
DROP FUNCTION IF EXISTS public.get_team_members() CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role) CASCADE;
DROP SEQUENCE IF EXISTS public.bug_tracking_seq CASCADE;

DROP TABLE IF EXISTS public.activity_log CASCADE;
DROP TABLE IF EXISTS public.attachments CASCADE;
DROP TABLE IF EXISTS public.comments CASCADE;
DROP TABLE IF EXISTS public.bugs CASCADE;
DROP TABLE IF EXISTS public.invitations CASCADE;
DROP TABLE IF EXISTS public.notification_preferences CASCADE;
DROP TABLE IF EXISTS public.company_settings CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

DROP TYPE IF EXISTS public.bug_severity CASCADE;
DROP TYPE IF EXISTS public.bug_status CASCADE;
DROP TYPE IF EXISTS public.app_role CASCADE;

CREATE TABLE public.notes (
  slug TEXT PRIMARY KEY,
  ydoc_state TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  char_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notes
  ADD CONSTRAINT notes_slug_format CHECK (slug ~ '^[a-zA-Z0-9_-]{1,64}$');

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read notes"
  ON public.notes FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can create notes"
  ON public.notes FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update notes"
  ON public.notes FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
