
## Mục tiêu

1. **Một chữ N duy nhất** — dùng `logo_syrin_note.png` cho mọi asset (extension icons + tile/marquee/promo + 5 screenshots). Không AI regen nữa.
2. Bộ **Playwright E2E riêng** cho extension (Alt+S + Settings reload).
3. **Component tests JSDOM** cho options.js (mock `chrome.storage`).
4. **Debug mode** (toggle Settings + UI panel + console prefix).
5. **Bộ Chrome Web Store listing** đầy đủ (title/short/long desc/changelog/permission justifications/video script).

---

## 1. Logo đồng bộ (không AI)

- Copy `user-uploads://logo_syrin_note.png` → `chrome-extension/icons/source.png` (master).
- Dùng `nix run nixpkgs#imagemagick` để resize có alpha padding ~10%:
  - `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png` (fit + center, transparent bg).
- **Store assets** — composite logo gốc lên nền giấy (cream `#F5F1E8`) + typography đen navy bằng ImageMagick (không AI):
  - `tile-440x280.png` — N trái + "Syrin Note" phải.
  - `marquee-1400x560.png` — N trái + tagline.
  - `promo-920x680.png` — N giữa-trên + "Syrin Note — Side Panel" + 3 bullets.
  - 5 screenshots 1280×800: thay bằng product-shot thực của preview app (Home, Settings options.html, slug note, markdown+preview, lock screen) với logo N nhỏ ở góc.

Script dùng: `scripts/build-store-assets.sh` (ImageMagick) — reproducible, không phụ thuộc AI credits.

Output đi vào `/mnt/documents/chrome-store/` (overwrite bộ cũ).

---

## 2. Playwright E2E riêng cho extension

Tạo suite **độc lập** không đụng tới `playwright.config.ts` hiện có:

```
e2e-extension/
  playwright.config.ts          # project riêng, headed chromium, persistent context
  fixtures/extension.ts          # launchPersistentContext + load chrome-extension/
  alt-s.spec.ts                  # Alt+S mở side panel ở 3 mode
  settings-reload.spec.ts        # Đổi mode → reload extension → verify storage + iframe src
  last-slug-sync.spec.ts         # Web app post message → lastSlug saved
```

Lệnh chạy: `bunx playwright test --config=e2e-extension/playwright.config.ts` (KHÔNG đưa vào CI mặc định — chỉ chạy local, để tránh flaky chromium-only).

**Kỹ thuật khó:**
- `chrome.sidePanel.open()` không thể trigger qua keyboard ở Playwright persistent context (commands API cần user gesture thật). Workaround: gọi trực tiếp `chrome.sidePanel.open({windowId})` từ service worker qua `chrome.runtime` evaluation, rồi assert side panel iframe load đúng URL theo `buildSrc`. Document rõ giới hạn này trong README.
- Settings reload: mở `chrome-extension://<id>/options.html` qua extension ID lấy từ service worker, fill form, submit, reload extension, đọc `chrome.storage.sync`.

---

## 3. JSDOM tests cho options.js

Thêm vào `chrome-extension/__tests__/`:

- `options.test.ts` — mock `chrome.storage.sync.get/set`, mount `options.html` qua `jsdom`, simulate radio change + slug input + submit, verify storage call + validate UI states (disabled, error shown, status text).
- ~15 test cases: mode switching, slug enable/disable, invalid slug error, save success, save failure (chrome.runtime.lastError), defaults loading.

Chạy chung với `bunx vitest run`.

---

## 4. Debug mode

**Settings UI** (`options.html`): thêm checkbox "Enable debug logging".

**Storage**: `debug: boolean` (default false), sync.

**Trong `sidepanel.js`**:
- Khi `debug=true`: render panel cố định góc dưới side panel hiển thị:
  - `lastSlug` hiện tại
  - History 10 dòng message: ack received, retry, origin rejected, storage write
  - Nút "Copy logs" và "Clear"
- Mọi log đi qua `dlog(...)` → console với prefix `[syrin-note][debug]` + push vào panel.

**Trong `background.js`**: `dlog` cho command listener + badge updates.

**Trong `NotePage.tsx`** (web app phía ext): nếu `?from=ext` và localStorage `syrin:debug=1` → log retry handshake. Toggle riêng vì web app không đọc được `chrome.storage`.

---

## 5. Chrome Web Store listing — file đầy đủ

Tạo `chrome-extension/STORE_LISTING.md` với mọi field copy-paste:

```
- Title (≤45 chars): Syrin Note — Side Panel Markdown
- Summary (≤132 chars): Markdown notes in Chrome's side panel. Write while you read. Alt+S to open. No tracking, no account required.
- Category: Productivity
- Language: English
- Detailed description (~1000 chars): vấn đề → giải pháp → features → privacy → keyboard shortcut → open source
- What's new — v1.2.0 changelog (bullets từ README)
- Permission justifications (sidePanel/storage/tabs) — câu cụ thể cho reviewer
- Single purpose statement
- Privacy practices answers (data collection: none; data usage: none; remote code: no)
- Screenshot captions (5)
- Video: YouTube unlisted URL placeholder + script 20s (giữ từ v1.2.0)
- Support email + privacy policy URL
- Vietnamese translation block (optional — same fields)
```

---

## 6. Bump + ZIP

- `manifest.json`: `1.2.0` → `1.3.0`.
- Rebuild `public/syrin-note-sidepanel.zip`.
- Cập nhật README "What's new in v1.3.0": logo nhất quán, debug mode, JSDOM options tests, Playwright e2e-extension suite.

---

## Files

**Create**
- `chrome-extension/icons/source.png` (master logo)
- `chrome-extension/STORE_LISTING.md`
- `chrome-extension/__tests__/options.test.ts`
- `scripts/build-store-assets.sh` (ImageMagick pipeline)
- `e2e-extension/playwright.config.ts`
- `e2e-extension/fixtures/extension.ts`
- `e2e-extension/alt-s.spec.ts`
- `e2e-extension/settings-reload.spec.ts`
- `e2e-extension/last-slug-sync.spec.ts`
- `e2e-extension/README.md`

**Edit**
- `chrome-extension/icons/icon-{16,32,48,128}.png` (regen từ source)
- `chrome-extension/options.html` + `options.js` + `options.css` (debug checkbox)
- `chrome-extension/sidepanel.html` + `sidepanel.js` + `sidepanel.css` (debug panel)
- `chrome-extension/background.js` (dlog)
- `chrome-extension/manifest.json` (1.3.0)
- `chrome-extension/README.md` (v1.3.0 section + e2e-extension docs)
- `src/pages/NotePage.tsx` (debug logging)
- `public/syrin-note-sidepanel.zip`
- 8 files trong `/mnt/documents/chrome-store/` (rebuild từ logo)

**Không đổi**
- `playwright.config.ts` chính (suite ext tách riêng)
- `vitest.config.ts` (đã include `chrome-extension/__tests__`)
- Business logic, RLS, Supabase
