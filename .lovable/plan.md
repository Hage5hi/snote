

# Phase 2: Encryption + Raw Endpoint + Admin + Split View + Pagination + AI Copy

## 1. E2E Encryption per-note (#3)

**Cơ chế**: Web Crypto AES-GCM 256-bit. Key string từ URL hash → PBKDF2-SHA256 (100k iterations) → AES key. Mỗi note có salt riêng lưu trong DB (`enc_salt`) để cùng passphrase sinh key khác nhau cho mỗi note.

**Schema mới (DB)**:
- `notes.is_encrypted boolean default false`
- `notes.enc_salt text` (base64, 16 bytes random per note)
- `notes.enc_check text` (ciphertext của chuỗi "OK" để verify key đúng)

**Khi note encrypted**:
- `ydoc_state` lưu là **ciphertext của Y.update** (encrypt toàn bộ binary update trước khi base64 + upload)
- `content` để rỗng (server không thấy plaintext)
- `char_count` = 0
- Realtime broadcast: cũng encrypt `Y.update` trước khi broadcast (server relay nhưng không hiểu)

**Flow**:
1. User mở `/abc#mykey` → app derive key từ `mykey` + salt
2. Load `enc_check` → decrypt → nếu OK thì proceed, sai thì hiện form "Khoá sai"
3. Toàn bộ update đi qua provider được encrypt/decrypt trong-flight
4. Nút lock/unlock trong topbar:
   - **Lock**: prompt key → encrypt toàn bộ doc hiện tại → upload + redirect tới `/abc#newkey`
   - **Change key**: prompt key cũ + mới → re-encrypt → redirect
   - **Unlock**: clear encryption flag → upload plaintext → strip hash

**Files**: `src/lib/crypto.ts`, `src/lib/yjs/encrypted-provider.ts` (extends provider behavior), update `Topbar` thêm nút Lock, update `NotePage` chọn provider theo `window.location.hash`.

## 2. Raw endpoint #9

**Edge function `raw`**: 
- URL: `https://nqkjyrgrquzjvpicmcpf.supabase.co/functions/v1/raw/<slug>`
- Trả `Content-Type: text/plain; charset=utf-8`
- Note thường: trả `content` cột
- Note encrypted: trả `ydoc_state` (ciphertext base64) + header `X-Encrypted: 1` + comment `# Encrypted note. Decrypt at https://...`
- Public, no auth (verify_jwt = false)
- CORS `*`

**Browser nice-URL `/xxx.md`**: Không thể implement không-redirect mà không có server (đã giải thích ở trên). Giải pháp:
- Route React: `/:slug.md` → component nhỏ, encrypted thì decrypt cục bộ và render `<pre>` plaintext, không-encrypted thì redirect tới edge function URL
- Topbar: nút **"Copy raw URL"** (DropdownMenu Export) — copy URL edge function, có hint "dùng cho cURL/wget/Python"

**Files**: `supabase/functions/raw/index.ts`, `src/pages/RawView.tsx`, route trong `App.tsx`, button trong Topbar.

## 3. Admin panel #4 (env-secret-protected)

**Secret**: `ADMIN_PASSPHRASE` (sẽ yêu cầu user nhập)

**Edge functions**:
- `admin-list`: POST với `{ passphrase, search?, limit?, offset? }` → trả list notes (slug, char_count, is_encrypted, updated_at, content preview 200 ký tự)
- `admin-delete`: POST với `{ passphrase, slugs[] }` → bulk delete

Cả hai dùng service role để bypass RLS. Validate passphrase bằng constant-time compare.

**UI** `/note`:
- Form nhập passphrase
- Sau auth: bảng list notes có search, checkbox bulk select, nút delete, "Delete all"
- Confirm dialog cho delete

**Files**: `supabase/functions/admin-list/index.ts`, `supabase/functions/admin-delete/index.ts`, `src/pages/AdminPanel.tsx`, route trong `App.tsx`.

## 4. Auto-cleanup TTL (bonus #4)

DB function + cron pg_cron không khả dụng dễ dàng. Thay vào đó: **edge function `cleanup`** chạy theo lịch hoặc khi admin trigger:
- Xoá note nếu `char_count = 0 AND created_at < now() - interval '1 hour'`
- Có thể setup cron qua Supabase scheduled functions

→ Để đơn giản và không cần pg_cron, tôi sẽ tạo function + nút "Run cleanup" trong admin panel. User có thể setup cron sau.

## 5. Split view #12

**Route**: `/:slugs` (slugs = `a+b`). React Router parse, nếu match regex `/^[\w-]+\+[\w-]+$/` → render `SplitView` component.

**Layout**: 2 panels 50/50 (vertical split trên mobile <768px, horizontal trên desktop). Mỗi panel = NotePage thu gọn (không topbar riêng, có 1 topbar chung mỏng hiển thị cả 2 slug + sync scroll toggle).

**Sync scroll**: ref scroll vào nhau, listen `onScroll` rồi tính ratio và set `scrollTop` panel kia. Toggle bật/tắt.

**Files**: `src/pages/SplitView.tsx`, refactor `NotePage` để tách `<NoteWorkspace>` component dùng chung.

## 6. Pagination mode #10

**Trigger**: nút trong Settings dropdown ("Lật trang") hoặc phím `Cmd+Shift+P`. State trong localStorage.

**Cơ chế**:
- Wrap CodeMirror scroller: cố định height = viewport, overflow hidden
- Tính `pageHeight = viewport - topbar - padding`
- Phím `Cmd+→` / `Cmd+←` (hoặc PageDown/PageUp) → scroll theo `pageHeight`
- Hiển thị "Trang X / Y" góc dưới phải

Đơn giản hoá: dùng CSS `scroll-snap` với `scroll-snap-type: y mandatory` và `scroll-snap-align: start` mỗi `pageHeight` — cho cảm giác snap-pagination, không cần JS phức tạp.

**Files**: `src/hooks/use-pagination.ts`, update `NotePage`.

## 7. AI Context Copy #13

Nút trong Topbar/Export dropdown "Copy as AI Context":
- Lấy content
- Strip: collapse `\n{3,}` → `\n\n`, trim trailing whitespace mỗi dòng, remove markdown comments `<!-- ... -->`, normalize spaces
- Wrap optional với header `# Note: /<slug>\n\n` để AI có context
- `navigator.clipboard.writeText` + toast "Đã copy N tokens (~X)" (ước tính bằng `Math.ceil(text.length / 4)`)

**Files**: `src/lib/ai-format.ts`, update `Topbar`.

## Database changes

```sql
ALTER TABLE public.notes
  ADD COLUMN is_encrypted boolean NOT NULL DEFAULT false,
  ADD COLUMN enc_salt text,
  ADD COLUMN enc_check text;

CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON public.notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_empty ON public.notes(created_at) WHERE char_count = 0;
```

## Secrets cần

- `ADMIN_PASSPHRASE` — passphrase cho admin panel (sẽ request)

## Files mới/sửa tóm tắt

**Tạo**:
- `src/lib/crypto.ts`, `src/lib/ai-format.ts`
- `src/pages/RawView.tsx`, `src/pages/AdminPanel.tsx`, `src/pages/SplitView.tsx`
- `src/components/note/NoteWorkspace.tsx` (refactor share giữa NotePage + SplitView)
- `src/components/note/LockButton.tsx`, `src/components/note/UnlockForm.tsx`
- `src/hooks/use-pagination.ts`
- `supabase/functions/raw/index.ts`
- `supabase/functions/admin-list/index.ts`
- `supabase/functions/admin-delete/index.ts`
- `supabase/functions/cleanup/index.ts`

**Sửa**:
- `src/lib/yjs/provider.ts` — hỗ trợ encrypt option
- `src/components/note/Topbar.tsx` — Lock, Copy raw URL, Copy as AI, Pagination toggle
- `src/pages/NotePage.tsx` — wire encryption + pagination
- `src/App.tsx` — routes mới
- DB migration

## Order triển khai

1. DB migration + request secret `ADMIN_PASSPHRASE`
2. Edge functions (raw, admin-list, admin-delete, cleanup) — deploy auto
3. crypto.ts + encrypted provider integration
4. UnlockForm + LockButton
5. RawView page + route + nút Copy raw URL
6. AdminPanel page + route
7. SplitView page + route
8. Pagination + AI Copy

