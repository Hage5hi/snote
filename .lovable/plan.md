

# Verify Phase 1 + Phase 2 — Kết quả

## ✅ Hoạt động đúng

**Phase 1**:
- PWA manifest serve OK tại `/manifest.webmanifest` (Content-Type: `application/manifest+json`, đầy đủ icons 192/512/maskable, theme/background colors)
- IndexedDB snapshots: logic 10 phút + anti-disaster (xoá >500 chars trong <2s) đúng, trim 10 bản FIFO
- HistoryDialog: list, view, restore trong Y.transact — sẽ broadcast như edit thường
- Zen mode: F11 + class `zen-mode` + hover-strip 8px, lưu localStorage
- E-ink: auto-detect `(update: slow)` + manual on/off, force B/W contrast, tắt mọi animation
- CSS font stack: Geist → system → CJK (JP/SC/TC/KR) → emoji
- CJK auto-detect lang attribute trong Editor (`detectLang`)
- Idle prefetch các module nặng + hover prefetch snapshot vào sessionStorage
- Code-split routes via `lazy()`

**Phase 2**:
- Edge function `raw` trả `text/plain; charset=utf-8`, hỗ trợ encrypted note (header `X-Encrypted: 1`)
- Edge function `admin-list/admin-delete/cleanup` trả `401` đúng khi sai passphrase, dùng constant-time compare
- Encryption: AES-GCM 256, PBKDF2 100k, salt random per-note, `enc_check` verify key
- Provider có hook `encrypt`/`decrypt` áp dụng cho cả broadcast lẫn snapshot — server zero-knowledge
- LockButton: lock/unlock/copy URL kèm khoá; reload sau lock để re-mount provider sạch
- UnlockForm: xử lý sai khoá, replaceState để giữ hash
- RawView page: `/xxx.md` cho note thường + tự decrypt nếu có `#key`
- AdminPanel: passphrase trong sessionStorage, search, bulk delete, cleanup
- SplitView: `/a+b` 2 panels, sync scroll qua `cm-scroller`
- Pagination + AI Copy + Copy raw URL (disabled khi encrypted)

## ⚠️ Vấn đề phát hiện (cần fix)

**1. Console warning: `forwardRef` cho `ThemeToggle` & `InstallPrompt`** (Home.tsx)
   - Lý do: `Home` không truyền ref nhưng React DevTools cho rằng có. Nguồn không rõ — nhiều khả năng do `<TooltipProvider>` ở App-level wrap children. Không gây lỗi chức năng nhưng làm noise console.
   - Fix: wrap `ThemeToggle` và `InstallPrompt` bằng `React.forwardRef` (no-op forward) — 2 dòng/file.

**2. Pagination CSS chưa thực sự "lật trang"**
   - Hiện tại `:nth-child(20n)` — gán snap-align mỗi 20 dòng — không chính xác = 1 viewport. Người dùng sẽ thấy snap ngẫu nhiên giữa các dòng.
   - Fix: bỏ snap-by-line, dùng JS handler bắt phím `PageUp/PageDown/Cmd+→/←` scroll theo `clientHeight` của `.cm-scroller`. Hiển thị "Trang X/Y" ở góc.

**3. Cleanup edge function chỉ xóa khi `is_encrypted = false`**
   - Note encrypted rỗng (vừa lock note trống) cũng nên dọn được. Hiện tại bỏ qua.
   - Fix: dùng điều kiện `(char_count = 0 AND is_encrypted = false) OR (is_encrypted = true AND length(ydoc_state) < 100)` — encrypted-but-empty có ydoc_state rất ngắn (chỉ là check + IV). Hoặc đơn giản hơn: bỏ filter `is_encrypted` (encrypted note rỗng cũng có `char_count = 0`).

**4. Admin delete "all" dùng `.neq("slug", "")` — risky**
   - Nếu `slug` field có trim issues hoặc edge case, có thể không xóa hết. Dùng `.gte("created_at", "1970-01-01")` an toàn hơn, hoặc dùng raw SQL `truncate`-style qua RPC.
   - Mức độ: thấp (hoạt động bình thường), nhưng nên cleanup.

**5. SplitView render cùng slug với chính nó (`/a+a`) — provider conflict**
   - Topbar có link `/${slug}+${slug}` = "Mở Split view (cùng note)" → 2 NotePage cùng slug tạo 2 Y.Doc khác nhau cho cùng channel realtime. Hiện tại chạy được nhờ Yjs CRDT tự merge, nhưng tốn double bandwidth + có thể tạo presence ghost.
   - Fix: validate `left !== right` trong SplitView, redirect nếu trùng. Hoặc bỏ link "cùng note" trong dropdown vì gây confusion.

**6. RawView KHÔNG được route** (BUG nghiêm trọng)
   - `App.tsx` `SlugDispatcher` check `/\.md$/i.test(slug)` → render `RawView`. Nhưng `RawView` extract slug bằng `.replace(/\.md$/i, "")` — đúng.
   - Tuy nhiên trên Lovable hosting, URL `/test.md` sẽ được SPA fallback xử lý, vào React Router → `/:slug` match → `slug="test.md"` → SlugDispatcher detect `.md` → RawView. Logic chạy được.
   - **NHƯNG** cURL/wget gọi `/test.md` sẽ nhận `index.html` (không phải plain text) như đã ghi nhận. Cần đảm bảo Topbar nói rõ: nút "Copy raw URL" trỏ thẳng edge function, không phải `/test.md`.
   - Đã đúng trong code (`copyRawUrl` dùng `${SUPABASE_URL}/functions/v1/raw/${slug}`). Chỉ cần thêm tooltip giải thích.

**7. Snapshot khi encrypted — `prevContent.length` sẽ luôn = 0**
   - Trong NotePage, `recordOnSuddenDelete` so sánh `prevContent.length`. Khi note encrypted, `ytext.toString()` vẫn trả plaintext (vì decrypt đã chạy ở provider). Nên anti-disaster vẫn hoạt động đúng. ✓ (Không phải bug, chỉ verify.)

**8. Console warnings React Router future flag** — chỉ là deprecation, không affect.

## Đề xuất hành động

Plan này list các fix cần làm. Tôi sẽ prioritize:
- **Cao**: #2 (pagination thật sự), #5 (split view same-slug), #6 tooltip raw URL
- **Trung**: #1 forwardRef warnings, #3 cleanup encrypted-empty
- **Thấp**: #4 admin delete-all SQL hygiene

Sau khi fix, test thủ công các luồng:
1. Tạo `/abc`, gõ tiếng Việt + 中文 + emoji → check Saved status
2. Lock note với key "test123" → reload → verify URL có `#test123`, vẫn đọc được
3. Mở `/abc.md` trong tab mới (note đã lock) → verify decrypt OK
4. cURL `https://...supabase.co/functions/v1/raw/abc` → verify trả ciphertext + `X-Encrypted: 1`
5. Mở `/abc+xyz` → 2 panel + sync scroll
6. Bật pagination, F11 zen, settings e-ink
7. `/note` → nhập admin passphrase → list/delete/cleanup
8. History dialog: gõ ≥600 chars → Cmd+A Backspace → check snapshot tự lưu

