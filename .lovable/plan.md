# Plan: Chrome Extension v1.2.0 — Polish & Launch Assets

## 1. Alt+S — kiểm thử và làm chắc (background.js)

Chrome's `chrome.sidePanel.open()` cần user gesture (Alt+S đáp ứng), nhưng có 3 edge cases dễ trượt:

- **Tab `chrome://*` / `chrome-extension://*`**: `chrome.tabs.query` trả tab nhưng `sidePanel.open({tabId})` reject. → Dùng `{windowId}` (đã đúng) thay vì `{tabId}` để mở panel ở cấp window.
- **Không có active tab** (ví dụ Detached DevTools là cửa sổ chính): `tab` undefined → log + no-op (đã đúng).
- **Focus sau khi mở**: Chrome tự focus iframe sau load. Web app cần ensure editor không auto-focus chặn — verify bằng tay sau khi rebuild.

Cải tiến nhỏ:
- Thêm fallback `chrome.windows.getCurrent()` khi `chrome.tabs.query` trả mảng rỗng.
- Log structured error code để dễ debug.

Không tự test bằng Playwright (theo lựa chọn A của bạn) — kiểm thử thủ công sau khi cài lại extension.

## 2. Badge "H"/"S"/"L" trên toolbar icon (background.js)

- Định nghĩa `applyBadge(settings)`: text = `"H"`/`"S"`/`"L"`, background `#1e3a8a` (navy watercolor), color trắng.
- Gọi `applyBadge` ở 3 điểm:
  1. `chrome.runtime.onInstalled` — load settings từ `chrome.storage.sync` rồi set.
  2. `chrome.runtime.onStartup` — tương tự.
  3. `chrome.storage.onChanged` (filter `areaName === "sync"` và `changes.openMode`) — cập nhật realtime khi user save Settings.
- Default `openMode: "home"` → badge `"H"` ngay sau cài.

## 3. postMessage hardening (sidepanel.js + NotePage.tsx)

Vấn đề hiện tại: web app post `syrin:slug` ngay khi `slug` đổi, nhưng nếu sidepanel.js chưa attach listener (race khi iframe load chậm) thì message rớt → `lastSlug` không update.

**Side panel (`sidepanel.js`)**:
- Attach `window.addEventListener("message", ...)` **trước** khi set `iframe.src` (hiện đang sau — đảo thứ tự).
- Origin check đã có (`event.origin !== APP_ORIGIN`) — giữ.
- Throttle ghi `chrome.storage.sync.set({lastSlug})` (chỉ ghi khi slug khác giá trị hiện tại — tránh quota `MAX_WRITE_OPERATIONS_PER_MINUTE = 120`).
- `try/catch` quanh `chrome.storage.sync.set` (đã có) + thêm callback check `chrome.runtime.lastError`.
- Reply lại web app `{type: "syrin:ack", slug}` để web app biết đã nhận (cho phép retry).

**Web app (`NotePage.tsx`)**:
- Hiện tại post 1 lần per slug change. Đổi thành: post → đợi `syrin:ack` trong 500ms → nếu không có, retry tối đa 3 lần (1s interval).
- Listen `message` từ `event.source === window.parent` với check `event.data?.type === "syrin:ack"`.
- Target origin: post với `"*"` là OK (data không nhạy cảm — chỉ slug), nhưng để chặt: detect parent origin từ `document.referrer` lần đầu, sau đó dùng origin đó.

## 4. Settings E2E — Unit test (vitest)

Theo lựa chọn A: chỉ test pure logic, mock `chrome.storage`.

Tạo `chrome-extension/__tests__/options.test.ts` và `sidepanel.test.ts`. Vì code là plain JS không export, tách logic ra module được test:

- Tạo `chrome-extension/lib/build-src.js` (CommonJS-compatible ESM): export `buildSrc({openMode, defaultSlug, lastSlug, appOrigin})`. Import từ `sidepanel.js` và test.
- Tạo `chrome-extension/lib/validate-slug.js`: export `SLUG_RE`, `isValidSlug(s)`. Import từ cả `options.js` và `sidepanel.js`.

Test cases:
- `buildSrc`: home → `/?from=ext`, slug + valid → `/my-note?from=ext`, slug + invalid → fallback `/`, last + valid → `/last?from=ext`, last + empty → `/`.
- `isValidSlug`: 11 cases (empty, too long 65, valid 1ch, dash/underscore, unicode reject, space reject, etc.).
- `applyBadge` logic: pure function `badgeForMode(mode)` → "H"/"S"/"L".

Add to `vitest.config.ts` include: `"chrome-extension/__tests__/**/*.test.{js,ts}"`.

**Không** test thật `chrome.sidePanel.open` hay Alt+S trong CI (theo A).

## 5. Chrome Web Store assets (watercolor navy)

Style guide từ logo: watercolor xanh navy (#1e3a8a → #0f172a), nền trắng/kem, texture giấy, brush stroke organic. Không gradient AI sến.

**Icons** (regen từ logo watercolor user gửi):
- `imagegen--edit_image` từ `user-uploads://note_syrin_logo.png` → tạo bộ icon vuông có padding nhỏ, 4 size: 16/32/48/128. Lưu `chrome-extension/icons/icon-{size}.png`.

**Store assets** (lưu `/mnt/documents/chrome-store/`):
- `tile-440x280.png` — logo trung tâm + tagline "Notes in your side panel" — `imagegen--generate_image` premium quality.
- `marquee-1400x560.png` — banner ngang, logo trái + 3 keyword bullet bên phải.
- `promo-920x680.png` — square-ish promo với mockup side panel.
- 5 screenshots `screenshot-{1..5}-1280x800.png`. Mỗi screenshot là composite của Chrome window mockup + side panel mở:
  1. **Hero**: trang web bất kỳ + side panel show Editor mode
  2. **Settings page**: options.html đã render
  3. **Default slug**: side panel mở đúng note user chọn
  4. **Markdown preview**: split editor/preview
  5. **Lock/unlock**: encrypted note flow

Workflow cho screenshots: dùng `browser--screenshot` lên preview URL → composite bằng skill `product-shot` (mesh gradient `arctic` để hợp watercolor navy) hoặc PIL script tự code. Vì chưa có Chrome browser thật với extension loaded, screenshot sẽ là **mockup** (web app fullscreen rồi crop dạng side panel 400×800).

Output deliverables:
```
/mnt/documents/chrome-store/
├── tile-440x280.png
├── marquee-1400x560.png
├── promo-920x680.png
├── screenshot-1-hero.png
├── screenshot-2-settings.png
├── screenshot-3-default-slug.png
├── screenshot-4-preview.png
└── screenshot-5-lock.png
```
Kèm `<presentation-artifact>` cho từng file để bạn download.

**Video YouTube**: bạn tự quay (lựa chọn B) — tôi chỉ cung cấp script gợi ý 20s trong README:
1. (0-3s) Mở Chrome bất kỳ trang
2. (3-5s) Bấm Alt+S → side panel slide in
3. (5-12s) Gõ markdown, preview render real-time
4. (12-17s) Mở Settings, set default slug
5. (17-20s) Logo + "Syrin Note — Side Panel"

## 6. Bump version + rebuild ZIP

- `manifest.json`: `1.1.0` → `1.2.0`
- `README.md`: changelog v1.2.0 (badge, postMessage retry, asset bundle, kiểm thử unit)
- Rebuild `public/syrin-note-sidepanel.zip` qua `nix run nixpkgs#zip`

## Files

**Create**:
- `chrome-extension/lib/build-src.js`
- `chrome-extension/lib/validate-slug.js`
- `chrome-extension/__tests__/build-src.test.ts`
- `chrome-extension/__tests__/validate-slug.test.ts`
- `chrome-extension/__tests__/badge.test.ts`
- `chrome-extension/icons/icon-{16,32,48,128}.png` (overwrite, watercolor version)
- `/mnt/documents/chrome-store/*.png` (8 files)

**Edit**:
- `chrome-extension/manifest.json` (version 1.2.0)
- `chrome-extension/background.js` (badge logic, settings listener)
- `chrome-extension/sidepanel.js` (attach listener trước iframe.src, ack reply, throttle)
- `chrome-extension/options.js` (import shared validate-slug)
- `chrome-extension/README.md` (changelog, video script, asset list)
- `src/pages/NotePage.tsx` (postMessage retry + ack listener)
- `vitest.config.ts` (include chrome-extension tests)
- `public/syrin-note-sidepanel.zip` (rebuild)

## Không làm

- ❌ Playwright E2E load extension (theo lựa chọn A)
- ❌ Tự quay video (theo lựa chọn B)
- ❌ Đổi CSP/headers, crypto, Yjs, service worker
- ❌ Thêm width adjustment (Chrome không có API)
- ❌ Đổi business logic web app ngoài postMessage retry

## Câu hỏi xác nhận trước khi build

1. **Icon mới**: tôi sẽ regen từ logo watercolor → vuông có padding ~12%, nền trong suốt cho chỗ trống. OK chứ, hay giữ icon hiện tại?
2. **`/mnt/documents/chrome-store/`**: bạn download và submit lên Web Store thủ công đúng không? (Không commit vào repo)
3. **postMessage origin**: dùng `"*"` (đơn giản, slug không nhạy cảm) hay strict origin từ `document.referrer`?
