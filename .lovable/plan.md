

# Quét hệ thống — Báo cáo & Plan Fix

## ✅ Đã verified OK

- **Edge function `raw`**: trả 200, content-type `text/plain; charset=utf-8`, UTF-8 (Vietnamese + 中文 + 한국어) đúng
- **Encryption pipeline**: AES-GCM 256, PBKDF2 100k, salt 16 bytes, IV 12 bytes — đúng chuẩn Web Crypto
- **Provider hooks**: encrypt/decrypt áp dụng cho cả broadcast & snapshot, server zero-knowledge khi locked
- **Admin functions**: constant-time passphrase compare, service role qua env, không leak qua client
- **DB indexes**: `idx_notes_updated_at`, `idx_notes_empty` đã tạo, query admin/cleanup nhanh
- **Pagination JS**: dùng `clientHeight` + smooth scroll, không hijack arrow keys khi đang gõ
- **Snapshot logic**: anti-disaster (>500 chars trong <2s), trim 10 bản FIFO

## 🔴 BUG nghiêm trọng

### B1. Runtime error: "Component is not a function" + `forwardRef` warning cho `InstallPrompt`
Console log:
```
Warning: Function components cannot be given refs.
Check the render method of `Home`.
at InstallPrompt
```
`InstallPrompt` được render trong `<main>` thường, không có asChild — nhưng cảnh báo vẫn xuất hiện, có thể do React detect Fragment-passing. Runtime error `Component is not a function` cùng stack có khả năng cao do **lazy import vòng**: `Home → InstallPrompt → ...` hoặc **stale HMR cache** sau khi đã thêm `forwardRef` cho `ThemeToggle`.

**Fix**: Wrap `InstallPrompt` bằng `forwardRef` (no-op) để dập warning. Nếu vẫn còn runtime error, force-refresh dev server.

### B2. `Topbar` import `useEink` từ hook nhưng `NotePage` cũng mount `useEink()` — **conflict 2 instance**
`Topbar` có `const { pref: einkPref, setMode } = useEink()`, mà `NotePage` cũng `useEink()`. Cả 2 instances cùng add/remove class `eink` trên `<html>` qua effect riêng → race condition: khi user toggle ở Topbar, Topbar instance set class, nhưng NotePage instance vẫn nghĩ vẫn `auto` → có thể flicker.

**Fix**: `useEink` không idempotent đủ. Thêm guard: chỉ apply class nếu giá trị thực sự đổi. Hoặc tốt hơn: chuyển `useEink` thành 1 hook trả state đồng bộ qua localStorage event (đã làm trên `pref` qua localStorage write nhưng không listen `storage` event giữa instance trong cùng tab).

### B3. `cleanup` xóa note encrypted có **plaintext content** không tồn tại nhưng `ydoc_state` chứa data thực
`char_count = 0` cho mọi note encrypted (theo design), nên cleanup sẽ xóa **mọi note encrypted >1h tuổi nếu rỗng theo char_count**. Nhưng note encrypted có nội dung thực thì `ydoc_state` length vẫn >> 0. → Lỗi: cleanup hiện chỉ check `char_count = 0`, sẽ xóa NHẦM encrypted note có nội dung.

**Fix**: Thêm guard `length(ydoc_state) < 100` cho encrypted notes:
```sql
WHERE (is_encrypted = false AND char_count = 0)
   OR (is_encrypted = true AND length(ydoc_state) < 100)
```
Cần dùng filter chain Supabase JS: `.or('and(is_encrypted.eq.false,char_count.eq.0),and(is_encrypted.eq.true,...)')` hoặc 2 query riêng.

### B4. Snapshot `prevContent` race ở NotePage anti-disaster
Khi note encrypted, lúc mount provider mới → `idb.whenSynced.then` → `prevContent = ytext.toString()`. Trước thời điểm đó, `updateCounts` chạy với `prevContent = ""` ban đầu. Nếu remote update đến trước IDB sync, `prevContent.length = 0` nhưng text remote = 5000 chars → `removed = 0 - 5000 = -5000` → không trigger (số âm), an toàn. Nhưng nếu IDB có data cũ + remote applies xoá, có thể trigger false-positive.
**Mức độ**: thấp. Có guard `prevContent.length >= 500` đã loại được hầu hết edge case. Không fix ngay.

## 🟡 Bảo mật / Hardening

### S1. RLS policies "always true" cho UPDATE — risk nhẹ (theo design)
`notes` có policy `Anyone can update` USING `true` WITH CHECK `true`. Đây là design có chủ ý (note public). Nhưng có nghĩa là **bất kỳ ai biết slug đều xoá-trắng được nội dung của người khác**.

**Đề xuất**: Thêm trigger `BEFORE UPDATE` để **block UPDATE nếu là note encrypted nhưng client gửi `is_encrypted = false`** (chống ai đó xóa enc_salt/enc_check để khoá note vĩnh viễn).
Cụ thể:
```sql
CREATE FUNCTION public.notes_protect_encryption_strip()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Cho phép unlock (is_encrypted true→false) chỉ khi client cũng cung cấp content/ydoc_state mới (không trống)
  IF OLD.is_encrypted = true AND NEW.is_encrypted = false THEN
    IF length(NEW.ydoc_state) < 10 THEN
      RAISE EXCEPTION 'Cannot strip encryption without providing decrypted state';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
```
**Quyết định**: NOT fix — design là public, ai biết slug đều có quyền sửa. Nếu user muốn bảo vệ, hãy dùng encryption.

### S2. Admin passphrase trong sessionStorage + body request
- Plain text passphrase trong sessionStorage: an toàn vừa phải (chỉ same-origin tab).
- Passphrase đi trong POST body qua HTTPS — OK.
- **Không có rate limit** cho `admin-list/admin-delete`. Brute force theo speed Supabase edge ~10 req/s, với passphrase 16+ ký tự thì 10^28 tổ hợp = không khả thi. **Mức độ**: chấp nhận được.

**Đề xuất nhẹ**: thêm sleep ngẫu nhiên 200-500ms khi passphrase sai để slow brute force. Không phải critical.

### S3. `admin-list` search dùng `.or()` với raw user input — có ilike injection?
```ts
query.or(`slug.ilike.%${search}%,content.ilike.%${search}%`);
```
Supabase parser sẽ escape, nhưng nếu `search` chứa `,` hoặc `)`, có thể break query. Test: search = `a,slug.eq.foo)` → có thể gây malformed.

**Fix**: sanitize search — chỉ giữ alphanumeric + space + dấu cơ bản. Hoặc dùng `query.ilike("slug", ...).or(...)` cách an toàn hơn.

### S4. RawView load qua client SDK với anon key — RLS cho phép
Đúng theo design (note public). OK.

### S5. Biến môi trường preview Lovable
Edge function `raw` build URL `decrypt at https://${url.host.replace(/\.supabase\.co.*/, "")}.lovable.app/...` — sai cho custom domain. Hardcode subdomain nguy hiểm.

**Fix**: Bỏ URL gợi ý hoặc dùng env `APP_URL`.

## 🟢 Polish nhỏ

- **P1**: `Topbar` `useEffect` deps `[getContent]` ESLint disable — nên thêm vào deps thật (function ref ổn định nhờ closure ytext).
- **P2**: `index.html` còn meta `og:image` của project cũ "Triage" — nên bỏ hoặc thay placeholder.
- **P3**: `tailwind.config` còn token `--severity-*` không còn dùng.
- **P4**: `bug-attachments` bucket + storage policies vẫn còn từ project cũ — nên xóa để tránh confusion (security warning báo).

## Plan triển khai (ưu tiên)

| # | Mức | Việc |
|---|---|---|
| B1 | Cao | `forwardRef` cho `InstallPrompt` để dập warning + clear runtime error |
| B3 | Cao | Fix `cleanup` chỉ xoá encrypted note thực sự rỗng (ydoc_state ngắn) |
| B2 | Trung | Sync state giữa các instance `useEink` qua `storage` event |
| S3 | Trung | Sanitize search input trong `admin-list` (regex `/[%_,)]/g`) |
| S5 | Thấp | Bỏ hardcoded `.lovable.app` URL trong `raw` edge function |
| P2 | Thấp | Dọn meta tags Triage trong `index.html` |
| P4 | Thấp | Xóa bucket `bug-attachments` + policies cũ (không dùng) |

Sau fix sẽ test:
1. Reload `/` → console KHÔNG còn warning
2. Lock note → content hiện vẫn còn → cleanup không xoá nhầm  
3. Admin search với ký tự `%`, `,`, `)` → không lỗi
4. Raw endpoint encrypted → response không hardcode subdomain

