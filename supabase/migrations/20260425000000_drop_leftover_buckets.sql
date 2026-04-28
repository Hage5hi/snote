-- Drop leftover storage buckets from the original Lovable scaffold
-- (bug-tracker template). Snotes doesn't use file uploads, so these
-- `bug-attachments` and `avatars` buckets were only accepting writes
-- from authenticated users with no upstream feature — free CDN surface.
--
-- We drop the associated policies first (they reference storage.objects),
-- empty the buckets, then remove the buckets themselves. Safe to re-run.

-- 1. Drop storage.objects policies that reference these buckets.
DROP POLICY IF EXISTS "Users can upload own bug attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own bug attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload bug attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can view bug attachments" ON storage.objects;
DROP POLICY IF EXISTS "Bug attachments publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own bug attachments" ON storage.objects;

DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;

-- 2. Empty the buckets (if any objects snuck in).
DELETE FROM storage.objects WHERE bucket_id IN ('bug-attachments', 'avatars');

-- 3. Drop the buckets.
DELETE FROM storage.buckets WHERE id IN ('bug-attachments', 'avatars');
