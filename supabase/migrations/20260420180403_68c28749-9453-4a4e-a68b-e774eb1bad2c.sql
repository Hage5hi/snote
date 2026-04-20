CREATE TABLE public.admin_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pass_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;

-- No policies = default deny. Only service_role (used in edge functions) can access.