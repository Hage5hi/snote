# Plan: SceneToggle UX polish + perf caching

## Note on "Suggest task" (Lovable suggestions)
Đây là gợi ý phía nền tảng Lovable (hiện ở khung chat), không phải code trong project. Nếu không thấy chip "Suggested tasks" nữa, đó là thay đổi UI/AB của Lovable — không sửa được từ repo. Mình bỏ qua mục này trong plan.

## Audit của các đề xuất bạn đưa ra

| Đề xuất | Trạng thái hiện tại | Cần làm? |
|---|---|---|
| Route isolation (SceneToggle chỉ ở `/`) | ✅ Đã đúng — `<SceneToggle/>` chỉ render trong `src/pages/Home.tsx`, không có ở route nào khác | Không |
| ThemeToggle reset scene → `none` | ✅ Đã có (`setScene(SCENE_NONE)` trong `ThemeToggle.select`) | Thêm 1 test bảo vệ |
| Persistence localStorage | ✅ `useSceneTheme` đã đọc/ghi `home.scene` và đồng bộ qua `storage` + `scene-theme-change` | Không |
| Bỏ "None" + bỏ description trong dropdown | ✅ Đã filter `SCENE_NONE`; description hiện đã KHÔNG render (chỉ label + swatch) | Không |
| Keyboard nav | ✅ `DropdownMenuRadioGroup` (Radix) hỗ trợ sẵn ↑↓ Enter Esc | Không |
| Đổi `Neon Vapor` → `Neon Horizon` | ✅ Toàn bộ 6 ngôn ngữ trong `i18n/index.ts` đều đã là "Neon Horizon" | Không |
| Hover preview | ❌ Chưa có | **Làm** |
| Tối ưu Obsidian Ink + Zodiac Map (offscreen cache) | ⚠️ Partial — Zodiac có cache symbols ở mức module, nhưng labels + watermark vẫn vẽ mỗi frame; Obsidian Ink rebuild gradient mỗi frame | **Làm** |

Lưu ý chủ ý giữ nguyên:
- **Scene id `neon-vapor`** (key registry/CSS/localStorage) giữ nguyên — chỉ label hiển thị là "Neon Horizon". Đổi id sẽ vỡ localStorage của user hiện tại, CSS `[data-scene="neon-vapor"]`, và snapshot tests. Đây là pattern chuẩn (id = stable slug, label = i18n).
- Không xóa key i18n `scene.neon_vapor.*` vì cùng lý do.

## Việc sẽ làm

### 1. Hover preview trong SceneToggle (`src/components/SceneToggle.tsx`)
- Thêm state `hoverPreview: string | null`.
- Trên mỗi `DropdownMenuRadioItem`: `onMouseEnter` / `onFocus` → `setHoverPreview(e.id)`; `onMouseLeave` / `onBlur` → `setHoverPreview(null)`.
- Khi `open && hoverPreview && hoverPreview !== scene`: tạm thời `setScene(hoverPreview)` (không ghi đè localStorage cho preview).
- Đóng menu mà không chọn → restore scene gốc.

Cách tiếp cận thực thi: lưu `committedSceneRef` khi mở menu; gọi `setScene` cho preview (vẫn ghi localStorage — chấp nhận, vì preview là tạm và sẽ ghi lại scene gốc khi đóng). Để tránh thrash localStorage, mở rộng `useSceneTheme` với `previewScene(id)` — set state in-memory + dispatch `scene-theme-change`, **không** ghi localStorage. Commit thật sự chỉ khi user click chọn (đi qua `setScene` cũ).

Đụng chạm:
- `src/hooks/use-scene-theme.ts`: thêm `previewScene(id | null)` — chỉ dispatch event in-memory; thêm `committedScene` (giá trị từ localStorage). SceneHost/Home tiếp tục đọc `scene` như cũ.
- `src/components/SceneToggle.tsx`: dùng `previewScene` khi hover, `setScene` khi click, clear preview khi `onOpenChange(false)`.
- Guard `prefers-reduced-motion`: skip preview để tránh nháy.

### 2. Test bảo vệ
- `ThemeToggle.test`: chọn light/dark → assert `localStorage["home.scene"] === "none"`.
- `SceneToggle.hover-preview.test`: hover item → scene state đổi; close menu không click → scene revert.

### 3. Tối ưu perf

**Zodiac Map (`DigitalConstellation.tsx`)**
- Tách render thành 2 layer: **static layer** (offscreen `OffscreenCanvas` hoặc `<canvas>` ẩn) chứa watermark symbols (♈︎–♓︎) + labels mono (CAP, "22/12 - 19/1"…) + lưới grid. Build 1 lần khi resize.
- **Dynamic layer**: chỉ vẽ stars + edges với alpha "breathing" + background dust mỗi frame.
- Mỗi frame: `clear → drawImage(staticCanvas, 0, 0) → vẽ dynamic`. Giảm ~60-70% chi phí text rendering.
- Giữ throttle 30fps (`FRAME_MS = 1000/30`).

**Obsidian Ink (`ObsidianInk.tsx`)**
- Cache paper-grain gradient + texture vào offscreen canvas khi resize (hiện rebuild gradient mỗi frame).
- Cùng pattern: blit static layer + chỉ vẽ ink diffusion động.
- Verify 30fps cap đã có; nếu chưa, thêm.

### 4. Verification
- `npm run lint` + tests liên quan.
- Manual: mở dropdown → hover từng scene → thấy background đổi → đóng dropdown không click → background quay lại scene cũ.
- DevTools Performance: 1 frame trên Zodiac nên < 8ms ở 30fps cap (trước: ~12-15ms do text rendering).

## File sẽ chỉnh
- `src/hooks/use-scene-theme.ts` — thêm `previewScene`
- `src/components/SceneToggle.tsx` — hover/focus preview
- `src/components/home/scenes/DigitalConstellation.tsx` — tách static/dynamic layer
- `src/components/home/scenes/ObsidianInk.tsx` — cache paper grain
- Tests: `ThemeToggle.i18n.test.tsx` (mở rộng), `SceneToggle.hover-preview.test.tsx` (mới)

Không đụng: registry, i18n strings, ThemeToggle logic, CSS scene tokens.
