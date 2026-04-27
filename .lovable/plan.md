# Consolidated migration — drop leftover buckets + create `note_shares`

## Bối cảnh đã verify
- `public.note_shares` **không tồn tại** trên production → share-create đang silently broken (sẽ trả 500).
- Buckets `avatars` + `bug-attachments` **vẫn tồn tại** → cần drop.
- File gốc `20260424150132_add_note_shares.sql` chỉ chứa: `CREATE TABLE` + `CHECK constraint` + `ENABLE RLS`. Không có index riêng (UNIQUE đã tạo index trên slug), không trigger, không comment object.
- Migration sẽ idempotent hoàn toàn — an toàn để re-run.

## Migration mới: `20260425030000_consolidate_buckets_and_shares.sql`

```sql
-- Part A: Drop leftover storage buckets from the original bug-tracker scaffold.
-- Idempotent: DROP POLICY IF EXISTS + DELETE WHERE.

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

DELETE FROM storage.objects WHERE bucket_id IN ('bug-attachments', 'avatars');
DELETE FROM storage.buckets WHERE id IN ('bug-attachments', 'avatars');

-- Part B: Create note_shares table for read-only share links.
-- Token maps to slug server-side; viewer never learns the slug.
-- All access via Edge functions (service role); RLS deny-all.

CREATE TABLE IF NOT EXISTS public.note_shares (
  token TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE REFERENCES public.notes(slug) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CHECK constraint with idempotent guard (ALTER TABLE doesn't support IF NOT EXISTS for constraints).
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
-- No policies. Deny-by-default. Access only via share-* Edge functions.
```

## Verify queries (sau khi apply)

```sql
-- 1. Migration version có trong schema_migrations
SELECT version FROM supabase_migrations.schema_migrations
ORDER BY version DESC LIMIT 5;

-- 2. note_shares table tồn tại với đầy đủ constraint
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'note_shares';

SELECT conname FROM pg_constraint
WHERE conrelid = 'public.note_shares'::regclass;

-- 3. Buckets đã bị xoá
SELECT id FROM storage.buckets WHERE id IN ('avatars', 'bug-attachments');
```

## Expected output
- Query 1: có `20260425030000` ở top.
- Query 2: `note_shares` xuất hiện; constraints gồm `note_shares_pkey`, `note_shares_slug_key`, `note_shares_slug_fkey`, `note_shares_token_format`.
- Query 3: trống (0 rows).

## Sau khi verify pass
- Tôi báo cáo lại 3 kết quả query cho bạn.
- Bạn quyết định cleanup 3 file repo redundant (`20260424150132`, `20260425000000`, `20260425120000`) — tôi sẽ chờ ping.
- Bạn test thực tế Generate share link trên production để confirm PR #18 hoạt động end-to-end.

## Không thay đổi
- Code app (Edge functions `share-*` đã đúng, không cần sửa).
- Các file migration cũ — giữ nguyên cho tới khi bạn approve cleanup riêng.
