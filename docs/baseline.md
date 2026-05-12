# Baseline (Phase 0)

> Đo trước khi bắt đầu upgrade. Tất cả các phase sau phải so sánh ngược lại file này.
> Ngày đo: 2026-05-12. Build: `bun run build` (vite 5.4.21).

---

## 1. Bundle size (production build)

### Initial chunks loaded trên route `/` (Home)

Initial graph = `index.html` → `index-*.js` (entry) → các vendor chunk được static-import từ entry.

Reachable từ entry (kiểm tra qua manualChunks rule trong `vite.config.ts`):

| Chunk | Size (raw) | Size (gzip) | Ghi chú |
|---|---:|---:|---|
| `index-Bdez1WNz.js` | 114.98 KB | 35.62 KB | Entry (App + Home + router) |
| `react-vendor` | 187.09 KB | 61.78 KB | React + react-router |
| `supabase-vendor` | 194.89 KB | 51.60 KB | @supabase/supabase-js + realtime |
| `radix-vendor` | 102.69 KB | 30.45 KB | Radix primitives đang dùng |
| `yjs-vendor` | 100.22 KB | 31.20 KB | yjs + y-indexeddb + y-protocols |
| `md-vendor` | 66.70 KB | 21.76 KB | marked + dompurify (Home không load — chỉ NotePage) |
| `index-CIeRzDiS.css` | 66.26 KB | 11.71 KB | Tailwind + index.css |

**→ Initial bundle route `/` (JS only, gzip)**: ~210 KB
- entry + react-vendor + supabase-vendor + radix-vendor + yjs-vendor (Home dùng tất cả qua App.tsx static imports)
- `md-vendor` và `cm-vendor` (569 KB!) chỉ load khi vào NotePage (dynamic import).

### Lazy chunks (dynamic, không tính vào initial)

| Chunk | Size (raw) | Khi nào load |
|---|---:|---|
| `cm-vendor` | 569.13 KB | NotePage (CodeMirror) |
| `NotePage` | 81.79 KB | route `/n/:slug` |
| `chunk-a8f3` (AdminPanel) | 64.27 KB | route `/admin` |
| `qrcode-vendor` | 24.08 KB | ShareDialog |
| `turndown.browser.es` | 10.89 KB | paste markdown từ HTML |
| `UnlockForm` | 5.14 KB | Note bị khoá |
| `SharePage` | 3.30 KB | `/s/:token` |
| `SplitView` | 3.04 KB | NotePage split mode |
| `crypto` | 2.22 KB | Encrypted note |
| `RawView` | 2.16 KB | `/raw/:slug` |

### Hard gate cho các phase tới

- **Initial bundle route `/` không tăng quá +5 KB gzip** (~ +215 KB tổng) sau MỖI phase.
- Sau Phase 3 (Editor power), grep trên `dist/assets/index-*.js` (entry chunk) phải = 0 match cho: `mermaid`, `katex`, `hljs`, `@replit/codemirror-vim`. Các thư viện này chỉ được phép xuất hiện trong chunk lazy (`mermaid-vendor`, `katex-vendor`, `hljs-vendor` — sẽ tạo trong Phase 1).

### Cách re-đo

```bash
bun run build 2>&1 | grep "dist/assets" | sort -k2 -h
```

So sánh dòng `index-*.js` (entry) + các vendor được Home import — nếu tổng gzip > 215 KB, phase đó vi phạm gate.

---

## 2. Lighthouse (sẽ đo thực tế khi review PR)

Chưa đo trong Phase 0 vì không có server prod sẵn. Sẽ đo trong Phase 1 sau khi deploy preview:
- Performance (Mobile 4G throttle)
- Accessibility
- Best Practices
- SEO

Mục tiêu các phase: không giảm Performance > 5 điểm.

---

## 3. Sync architecture (đo trước khi đổi)

### Code đã verify

`src/lib/yjs/provider.ts` hiện tại:
- **Class** `SupabaseYjsProvider` — broadcast Y.update binary qua Supabase Realtime channel `note:<slug>`.
- **Local cache** `y-indexeddb` (đã đủ cho offline editing — KHÔNG cần Service Worker cho note content).
- **Postgres snapshot** debounced 800ms vào `notes.ydoc_state` (base64).
- **Awareness** (presence + cursor) cùng channel, ping 15s.
- **beforeunload flush** qua `navigator.sendBeacon`.
- **SaveStatus** hiện chỉ có: `idle | editing | saving | saved | offline` (chưa tách peer-sync vs durable-snapshot).

→ **Sync ĐÃ instant.** Không cần đổi architecture trong Phase 2; chỉ thêm event emitter + indicator (xem plan v3).

### Latency hiện tại (cần đo thực tế bằng tay)

**Cách đo manual** (sẽ chạy lúc bắt đầu Phase 2):
1. Mở 2 tab cùng slug.
2. Thêm tạm trong `provider.ts` `applyRemoteUpdate`:
   ```ts
   if (import.meta.env.DEV) {
     const sentAt = (payload.payload as { sent_at?: number })?.sent_at;
     if (sentAt) console.log('[sync] broadcast→apply:', Date.now() - sentAt, 'ms');
   }
   ```
3. Gõ ở tab A 100 ký tự, đo p50/p95 ở tab B.
4. Kỳ vọng: p50 < 200 ms, p95 < 500 ms (Supabase Realtime free tier).

→ Nếu vượt ngưỡng đáng kể, mới cần optimize. Hiện tại giả định OK theo critique v2.

### Broadcast chatter hiện tại (cần đo)

- Mỗi keystroke = 1 `channel.send` (chưa batch).
- Khi gõ nhanh 30 ký tự/s = 30 message/s/channel.
- Phase 2.5 sẽ batch qua `requestAnimationFrame` + `Y.mergeUpdates` → kỳ vọng giảm xuống ≤ 5–10 msg/s.

---

## 4. Pre-existing typecheck warnings (KHÔNG sửa kèm)

Theo HANDOFF.md gốc của Replit và áp dụng nguyên tắc surgical changes:

1. `App.tsx` — BrowserRouter v7 future flag warning.
2. `ShareDialog` — qrcode types thiếu.
3. `StatusPill` — JSX warnings.
4. `calendar` (shadcn) — buttonVariants type mismatch.
5. `paste-markdown` — turndown types thiếu.

→ Sẽ fix riêng PR cuối hoặc khi chạm trực tiếp tới các file đó.

---

## 5. DB state (đã verify qua schema)

- `notes` (slug PK, ydoc_state, char_count, tags, is_encrypted, enc_*).
- `note_shares` (token PK, slug FK unique, created_at) — **chưa có** `expires_at`, `view_count`, `last_viewed_at` → sẽ thêm Phase 4.
- `admin_config` (id, pass_hash) — deny-all RLS.
- **Chưa có** `note_images` → sẽ tạo Phase 5.
- **Chưa có** storage bucket — sẽ tạo `note-images` ở Phase 5.

`pg_cron` + `pg_net` chưa enable → cần bật trong Cloud → Database → Extensions trước Phase 5.

---

## 6. Files đã xác định cần thêm (port từ Replit)

Tổng kết để tránh quên:

- **Phase 2:** `hooks/use-sync-status.ts`, `components/note/SyncIndicator.tsx`. Sửa `lib/yjs/provider.ts`.
- **Phase 3:** `lib/markdown-extensions.ts`, `lib/render-pipeline.ts`, `lib/worker-render-client.ts`, `lib/templates.ts`, `lib/paste-warn.ts`, `lib/wiki-link-expand.ts`, `hooks/use-vim-mode.ts`, `workers/render.worker.ts`, `workers/render-engine.ts`.
- **Phase 4:** Edge Functions `share-update`, `share-status`. Sửa `share-view`, `ShareDialog.tsx`, `pages/Home.tsx`, `pages/SharePage.tsx`. Migration `share_polish.sql`.
- **Phase 5:** `lib/image-upload.ts`, `lib/image-render.ts`, `lib/paste-image.ts`. Migration `note_images.sql` + bucket + pg_cron.
- **Phase 6:** Port tests + cập nhật `.github/workflows/ci.yml`.

---

*Đo bởi agent — Phase 0 done. Sẵn sàng vào Phase 1.*
