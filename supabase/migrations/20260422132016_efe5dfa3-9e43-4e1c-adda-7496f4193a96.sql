-- 1. Admin config: explicit restrictive deny-all policies (defense in depth)
-- RLS already denies by default with no policy, but an explicit restrictive
-- policy guarantees that no future permissive policy can ever expose pass_hash.
CREATE POLICY "Deny all reads on admin_config"
  ON public.admin_config
  AS RESTRICTIVE
  FOR SELECT
  TO anon, authenticated
  USING (false);

CREATE POLICY "Deny all writes on admin_config"
  ON public.admin_config
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- 2. Bug attachments: restrict SELECT to file owner (folder name = uid)
DROP POLICY IF EXISTS "Authenticated can view bug attachments" ON storage.objects;

CREATE POLICY "Users can view own bug attachments"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'bug-attachments'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- Also tighten the upload policy so users can only upload into their own folder
DROP POLICY IF EXISTS "Authenticated can upload bug attachments" ON storage.objects;

CREATE POLICY "Users can upload own bug attachments"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'bug-attachments'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- 3. Avatars: avatars bucket is public for direct-URL reads, but allowing
-- anonymous LIST exposes every filename. Restrict listing while keeping
-- direct object URLs working (public bucket flag handles those).
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;

CREATE POLICY "Authenticated can view avatars"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'avatars');