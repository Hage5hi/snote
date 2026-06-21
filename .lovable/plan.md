## Mục tiêu

Trên trang Home, thay card "Install as an app" hiện tại (có nút X đóng, có thể bị ẩn bởi localStorage hoặc khi không có `beforeinstallprompt`) bằng một panel **cố định, không thể đóng**, chia đều 2 cột:

- **Cột trái — Install as an app (PWA):** giữ nội dung hiện tại (icon, tiêu đề, mô tả theo platform iOS/Android/Desktop, nút Install khi có `beforeinstallprompt`).
- **Cột phải — Browser extension:** nút tải `syrin-note-sidepanel.zip` + hướng dẫn cài unpacked ngắn gọn, chính xác.

## Thay đổi

### 1. `src/components/note/InstallPrompt.tsx` — viết lại

- Bỏ hoàn toàn nút X, state `dismissed`, key `notes:install-dismissed` trong localStorage, và điều kiện `if (platform === "desktop" && !bipEvent) return null`.
- Vẫn ẩn khi đã chạy ở chế độ standalone (`isStandalone()` true) — tránh hiển thị thừa khi user đã cài PWA. Đây là hành vi hợp lý, không phải "đóng".
- Layout: `grid grid-cols-1 md:grid-cols-2` với divider dọc `md:divide-x divide-border`. Mỗi cột có padding riêng. Trên mobile xếp dọc.
- **Cột trái** giữ nguyên markup hiện tại (icon Smartphone + title + hint theo platform + nút Install khi `bipEvent`). Khi desktop không có `bipEvent`, hiển thị một dòng hint chung ("Use your browser's install icon in the address bar.") thay vì ẩn cột.
- **Cột phải** mới: icon `Puzzle` (lucide), tiêu đề "Browser extension", mô tả ngắn ("Open Notes in Chrome's side panel — Alt+S anywhere."), nút "Download .zip" tải `/syrin-note-sidepanel.zip` qua fetch+blob (preview env không cho `<a download>` trực tiếp), và `<ol>` 4 bước:
  1. Unzip the downloaded file.
  2. Open `chrome://extensions`.
  3. Enable Developer mode (top-right).
  4. Click "Load unpacked" and select the unzipped folder.

### 2. `src/i18n/index.ts` — thêm keys

Thêm vào tất cả locale (en, vi, zh, ja, ko, …) — keys mới:

- `install.desktop_no_bip` — fallback hint khi desktop không có beforeinstallprompt.
- `install.ext_title`, `install.ext_desc`, `install.ext_download`, `install.ext_step1..4`.

Giữ nguyên các keys cũ. Xoá `install.close` (không còn dùng) — hoặc để lại nếu rủi ro phá build, sẽ bỏ luôn vì không reference nữa.

### 3. `src/pages/Home.tsx`

Không đổi vị trí render. Vẫn `{!isExtensionContext && <InstallPrompt />}` — trong context extension thì không cần khuyến cáo cài extension/PWA.

## Không thay đổi

- Logic `beforeinstallprompt`, `isStandalone`, `detectPlatform` giữ nguyên.
- File extension zip `public/syrin-note-sidepanel.zip` đã có sẵn, không build lại.
- Không thay đổi component khác, không refactor Home.

## Kiểm chứng

1. Mở `/` ở desktop Chrome chưa cài PWA → thấy panel 2 cột, không có nút X.
2. Reload nhiều lần / xoá localStorage → panel vẫn hiện.
3. Click "Download .zip" cột phải → tải về `syrin-note-sidepanel.zip`.
4. Mobile viewport → 2 cột xếp dọc, vẫn không đóng được.
5. Khi đã cài PWA (standalone) → panel ẩn (đúng hành vi).
