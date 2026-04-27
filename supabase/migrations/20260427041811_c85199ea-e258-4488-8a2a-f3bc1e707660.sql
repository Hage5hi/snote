-- Drop orphan RLS policies on storage.objects left over from the deleted
-- avatars and bug-attachments buckets. Policies are scoped by bucket_id,
-- so they're inert now, but cleaning up keeps the security surface tidy.
DROP POLICY IF EXISTS "Authenticated can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own bug attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own bug attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own bug attachments" ON storage.objects;