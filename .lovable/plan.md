

# Phase 1: Core UX Upgrades (7 tính năng)

Triển khai #1, #2, #5, #6, #7, #8, #11 từ danh sách. Phase 2 (encryption, admin, raw endpoint, split view, AI copy, pagination) sẽ làm sau khi Phase 1 ổn định.

## 1. PWA — Add to Home Screen

**Lưu ý quan trọng**: Theo guideline Lovable, full PWA với service worker gây lỗi cache trong preview iframe. Vì bạn không cần offline-cache JS bundle (Yjs đã lo offline cho data), tôi sẽ làm **Installable Web App đơn giản** — chỉ cần `manifest.webmanifest` + meta tags, KHÔNG service worker:

- `public/manifest.webmanifest` — name, short_name, `display: "standalone"`, theme/background colors theo design tokens, start_url `/`
- `public/icon-192.png`, `icon-512.png`, `icon-maskable.png` (generate qua script)
- `index.html`: thêm `<link rel="manifest">`, `apple-touch-icon`, `apple-mobile-web-app-capable`, `theme-color` (dark + light qua media query)
- Trang home: card nhỏ "Cài đặt app" hiện trên iOS/Android khi chưa standalone, hướng dẫn "Share → Add to Home Screen"

→ Giữ được khả năng "mở app như native", không gây lỗi preview.

## 2. Nút "Copy tất cả"

- Topbar: thêm icon `Copy` riêng (cạnh export). Click = `navigator.clipboard.writeText(getContent())` + toast "Đã copy N ký tự"
- Phím tắt: `Cmd/Ctrl + Shift + C`

## 3. Local Snapshots (Khôi phục thảm họa)

Tạo `src/lib/snapshots.ts`:
- Lưu snapshot vào IndexedDB key `snapshots:<slug>` mỗi **10 phút**, chỉ khi nội dung khác bản gần nhất ≥50 ký tự
- Schema: `{ ts, charCount, preview (200 ký tự đầu), content }`. Giữ tối đa **10 bản** (FIFO)
- Bonus: cũng snapshot ngay khi phát hiện **xoá đột ngột >500 ký tự trong <2 giây** (anti-disaster)

UI `src/components/note/HistoryDialog.tsx`:
- Nút History trong topbar (icon `Clock`)
- Dialog list các bản: thời gian + char count + preview
- Mỗi bản có 2 nút: **Xem** (preview read-only) và **Khôi phục** (confirm → replace `ytext` toàn bộ bằng `ytext.delete(0, len) + ytext.insert(0, content)` trong 1 transaction → Yjs sẽ đồng bộ sang các thiết bị khác như edit bình thường)

## 4. Zen Mode + E-ink optimization

**Zen Mode**:
- Toggle bằng phím tắt `F11` hoặc nút icon eye-off
- Khi bật: ẩn topbar (auto-show khi hover top 8px), ẩn preview pane, max-width 680px, opacity các UI element thừa = 0
- State lưu localStorage

**E-ink mode** (auto-detect + manual toggle trong Settings popover):
- Auto-detect: media query `(update: slow) and (prefers-reduced-motion: reduce)` — match e-readers
- CSS class `.eink`:
  - `* { transition: none !important; animation: none !important; }`
  - Tăng contrast: `--foreground: 0 0% 0%`, `--background: 0 0% 100%` (force light, không có grayscale)
  - Tắt `caret-color` blink, tắt cursor animation trong CodeMirror
  - Force `color-scheme: light`

## 5. Font fallback đa ngôn ngữ + CJK line-breaking

Update `src/index.css`:
```css
body {
  font-family:
    'Geist',
    -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui,
    /* Vietnamese fallback đảm bảo dấu */
    'Helvetica Neue',
    /* CJK */
    'Hiragino Sans', 'Hiragino Kaku Gothic ProN',  /* JP */
    'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Noto Sans CJK KR',
    'PingFang SC', 'Microsoft YaHei',  /* SC */
    'Apple SD Gothic Neo', 'Malgun Gothic',  /* KR */
    sans-serif,
    /* Emoji */
    'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji';
}
.cm-content, .markdown-preview {
  font-feature-settings: "kern", "liga";
  word-break: normal;
  overflow-wrap: anywhere;
  line-break: strict;
}
.cm-content:lang(zh), .cm-content:lang(ja), .cm-content:lang(ko) {
  word-break: keep-all;
}
```

Editor `<div lang="zh-Hans-x-mixed">` (hoặc auto-detect đơn giản qua regex `/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/`).

## 6. Preload / Prefetch

Mục tiêu: mở `/xxx` mới trong <100ms.

Trong `src/pages/Home.tsx`:
- `useEffect` sau khi mount: dynamic-import warm các module nặng — `import("@/pages/NotePage")`, `import("yjs")`, `import("y-codemirror.next")`, `import("marked")`, `import("dompurify")` → resolve và discard. Chạy trong `requestIdleCallback`.
- Trên mỗi recent note item: `onMouseEnter` → prefetch snapshot từ Supabase (`select ydoc_state where slug=...`) và stash vào `sessionStorage` cache. NotePage check cache trước khi fetch lại.

`index.html`:
- `<link rel="preconnect" href="https://nqkjyrgrquzjvpicmcpf.supabase.co">`
- `<link rel="dns-prefetch" href="https://nqkjyrgrquzjvpicmcpf.supabase.co">`

## Trạng thái Phase 1 sau khi xong

- App cài được như native (PWA-lite, không SW)
- Copy 1 chạm + History recovery bảo vệ khỏi xoá nhầm
- Zen + E-ink mượt mà cho mọi loại màn hình
- Font hiển thị tiếng Việt + CJK chuẩn, không lỗi font
- Mở note mới gần như tức thì

## Files thay đổi

**Tạo mới**:
- `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable.png`
- `src/lib/snapshots.ts` (IndexedDB, không phụ thuộc Supabase)
- `src/components/note/HistoryDialog.tsx`
- `src/components/note/InstallPrompt.tsx` (banner cài app trên home)
- `src/hooks/use-eink.ts` (detect + toggle)
- `src/hooks/use-zen-mode.ts`

**Sửa**:
- `index.html` — manifest, theme-color, preconnect, apple meta
- `src/index.css` — font stack đa ngôn ngữ, `.eink`, `.zen-mode`, CJK rules
- `src/components/note/Topbar.tsx` — nút Copy all, History, Zen toggle
- `src/components/note/Editor.tsx` — auto-detect lang attr cho CJK
- `src/pages/Home.tsx` — InstallPrompt + idle-prefetch modules
- `src/pages/NotePage.tsx` — wire snapshot timer (mỗi 10') + anti-disaster detection

## Phase 2 (sẽ làm sau)

Đã ghi nhớ kế hoạch chi tiết:
- **#3 Encryption per-note** với Web Crypto AES-GCM, key từ URL hash, toggle trong topbar, đổi key (re-encrypt + redirect URL mới)
- **#4 Admin panel** `/note` với passphrase qua edge function `admin-auth` (passphrase trong secret `ADMIN_PASSPHRASE`), edge function `admin-list/delete` dùng service role
- **#9 Raw endpoint** edge function `raw` trả `text/plain`. Service Worker chặn `/xxx.md` proxy sang edge function (giữ URL đẹp cho browser); với CLI dùng URL trực tiếp `https://...supabase.co/functions/v1/raw/xxx` — sẽ thêm nút "Copy raw URL" cho user. Note encrypted: SW + inline script `<pre>` tự decrypt từ `#key`
- **#10 Pagination** mode (chia trang theo viewport height), `Cmd+Right/Left`
- **#12 Split view** `/a+b` với sync scroll
- **#13 AI Context copy** (strip whitespace thừa, comment markdown)

Sau khi bạn approve Phase 1 và test xong, tôi sẽ trình plan Phase 2 chi tiết.

