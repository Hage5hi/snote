
## 1. Visual QA — 6 scene × NotePage (Task 1+3)

Tạo `e2e/note-scenes-visual.spec.ts` (mirror của `home-scenes-visual.spec.ts`) nhưng nhắm vào `/qa-scene-note` (slug throwaway) thay vì `/`.

Với mỗi scene trong `SCENE_REGISTRY` (enabled, ≠ none):

- **Desktop 1280×720**: seed `localStorage["home.scene"] = scene` → goto `/qa-note-scene` → wait `networkidle`.
  - Assert `[data-app-root][data-scene="<id>"]` tồn tại.
  - Assert `--home-chrome-bg` resolve được trên `<header>`.
  - **Body solid check**: lấy `getComputedStyle(editorBody).backgroundColor`, assert alpha = 1 (không phải transparent). Pick element `.cm-editor` và `[data-preview-root]`.
  - **Scene chỉ ở chrome**: hit-test pixel giữa editor area → `elementFromPoint` KHÔNG được trả về SceneHost canvas (`[data-scene-ready]`). Scene canvas phải bị che bởi editor body.
  - Screenshot top-strip (header 0-44px) với mask `[data-scene-ready]` → baseline `note-scene-<id>-chrome.png`.

- **Mobile 390×844**: cùng seed, viewport mobile.
  - Assert topbar wrap thành 2 hàng (`.zen-topbar` có `flex-col`).
  - **Anti-overlap**: lấy bounding box của `SceneToggle`, `ThemeToggle`, `ModeMenu`, `ExportMenu` button. Assert không cặp nào có `Math.max(a.x, b.x) < Math.min(a.x+a.w, b.x+b.w)` đồng thời cùng y-row (overlap). Cụ thể: SceneToggle phải ở row 1, ModeMenu/ExportMenu ở row 2 → so sánh `box.y` khác nhau ≥ 20px.
  - Assert mọi tap target ≥ 36px (size="sm"/"icon" baseline của shadcn).

Chạy: `bunx playwright test e2e/note-scenes-visual.spec.ts --update-snapshots` lần đầu để gen baseline, commit, sau đó chạy lại bình thường.

## 2. Test infra: data-home-root → data-app-root (Task 2)

Rename attribute trên surface chung (AppShell). Home vẫn dùng cùng AppShell pattern, không còn phân biệt "home root".

**Files cập nhật:**
- `src/components/app/AppShell.tsx`: `data-home-root` → `data-app-root`. Cập nhật comment đầu file.
- `src/pages/Home.tsx`: tìm & replace `data-home-root="true"` → `data-app-root="true"` (cộng comment giải thích lịch sử bỏ đi).
- `src/index.css`: tất cả selector `[data-home-root]` → `[data-app-root]` (giữ nguyên `[data-scene="..."]` phần sau).
- `scripts/check-home-theme-isolation.ts`:
  - `required[]`: `data-home-root` → `data-app-root`.
  - `forbidden[]`: `data-home-root` → `data-app-root`.
  - Đổi tên file/log: "Scene tokens isolated from AdminPanel" giữ nguyên message.
- `e2e/home-scene.spec.ts`: tất cả `[data-home-root]` selector → `[data-app-root]` (5 chỗ ở section 4 & 5).
- `e2e/home-scenes-visual.spec.ts`: `page.locator("[data-home-root]")` → `[data-app-root]` (1 chỗ ở dòng 115).
- `e2e/note-scenes-visual.spec.ts` (file mới ở Task 1): dùng `data-app-root` ngay từ đầu.

**Rename script (optional)**: `bun run check:home-isolation` để verify forbidden tokens không leak.

## 3. UI: tách Copy URL & Copy content (TopbarBrand)

File: `src/components/note/topbar/TopbarBrand.tsx`.

**Trước:**
- `/scratch` là `<span>` (chỉ hiển thị).
- Nút Copy icon → copy `window.location.href`.

**Sau:**
- `/scratch` chuyển thành `<button>` với cùng style (font-mono, truncate). Click → copy URL `${window.location.origin}/${slug}` (dùng origin để luôn map đúng custom domain hiện tại — không hard-code `syrin.online`). Toast `t("toast.copied_url")`.
  - Bọc Tooltip "Copy URL".
  - Aria-label: `t("brand.copy_url")`.
- Nút Copy icon → đổi behavior: copy **toàn bộ nội dung note**. Cần `getContent: () => string` prop mới (Topbar đã có sẵn từ `copyAll`, chỉ cần pass xuống TopbarBrand).
  - Aria-label & tooltip: dùng key i18n mới `brand.copy_content` (thêm vào cả 7 locale, fallback "Copy content"/"Sao chép nội dung").
  - Toast: tái sử dụng `t("toast.copied_note")` + `t("toast.copied_chars", { n })` (đã có).
  - Nếu nội dung rỗng → toast `t("toast.note_empty")`.
- Encrypted note: nút copy content vẫn hoạt động (copy bản plain text đang giải mã). Nếu `isEncrypted` và editor chưa unlock (`getContent()` trả "") → toast empty.

**Topbar.tsx**: chuyển `copyAll` callback → pass `getContent` xuống `TopbarBrand`. Xóa shortcut Cmd/Ctrl+Shift+C khỏi Topbar nếu trùng — giữ nguyên (shortcut vẫn dùng `getContent` ở scope cha, không sao).

**i18n keys mới** (`src/i18n/index.ts`, 7 ngôn ngữ):
```
brand.copy_content
```

## 4. Verification

```
bun run check:home-isolation
bunx vitest run
bunx playwright test e2e/home-scene.spec.ts e2e/home-scenes-visual.spec.ts e2e/note-scenes-visual.spec.ts
```

Báo cáo số test pass/fail, screenshot diff nếu có.

## Out of scope (per user rejection)

- ❌ Task 7 (override `prefers-reduced-motion`) — luôn tôn trọng OS flag.
