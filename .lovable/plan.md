# Kế hoạch: Tách nút Scene + nâng cấp 6 theme

## Phần A — Tách UI: Scene picker thành nút riêng

**Thay đổi:**
- `ThemeToggle` quay về đúng vai trò: chỉ Sáng / Tối / Theo hệ thống (3 mục, icon Sun/Moon hiện tại). Bỏ toàn bộ logic scene khỏi component này.
- Tạo `SceneToggle` mới (`src/components/SceneToggle.tsx`): nút icon riêng (icon `Sparkles` từ lucide), dropdown chỉ hiển thị 6 scene + mục "Mặc định" (none). Mỗi mục giữ nguyên swatch gradient + label + mô tả như hiện tại. Khi chọn scene có `forceColorScheme`, vẫn ép next-themes theo (giữ nguyên hành vi).
- **Chỉ hiển thị ở Home** (`/`): `SceneToggle` ẩn ở các route khác. Trong `Topbar.tsx` (editor) không render `SceneToggle`.
- Trong `src/pages/Home.tsx` đặt thứ tự nút (phải→trái): `ThemeToggle` (sáng/tối/hệ thống) → `LanguageToggle` → **`SceneToggle` (mới, đứng TRƯỚC LanguageToggle theo yêu cầu)**.
  - Đúng yêu cầu: "gom 6 theme ra 1 nút trước hiện trước nút Chọn ngôn ngữ".
- Thêm key i18n: `scene.toggle.aria`, `scene.toggle.label`, `scene.section.label` (vi/en).
- Cập nhật test `ThemeToggle.i18n.test.tsx` (giờ chỉ assert 3 mục color) và thêm test mới `SceneToggle.i18n.test.tsx`.

## Phần B — Nâng cấp 6 theme

Triết lý chung: giữ nguyên contract `SceneProps`, FPS cap, pause-on-hidden, fallback WebGL — chỉ làm đẹp hơn về thị giác. Mỗi scene có một "wow moment" rõ rệt và bảng màu cô đọng hơn. Tất cả vẫn tôn trọng `prefers-reduced-motion` và `pixelDiffRatio` đã set.

### 1. Cyber Linh Khí — "Khí jade chảy"
- Thêm domain warping 2 lớp (fBm warp warp) tạo dải khí cuộn dài thay vì blob tròn.
- Thêm "ember motes": 6–8 đốm jade rất nhỏ trôi chậm (sin/cos drift, alpha pulse) phủ lên fog → tạo cảm giác linh khí có hạt.
- Thêm subtle chromatic shift: tách kênh G/B 0.5px ở vùng peak → ánh ngọc bích hơn.
- Vignette mềm hơn (cubic ease), thêm grain tĩnh 8% để khử banding trên OLED.

### 2. Ethereal Aurora — "Dải pastel mơ màng"
- Đổi sang **curl-noise ribbons** (3 dải): mỗi dải là một hàm sin(p.x*freq + fbm(p,t)) với độ rộng feather. Pha lệch nhau → chuyển động interweaving thật.
- Bảng màu lock: indigo deep #1a0a3a → lavender #b794f4 → rose mist #fbcfe8 → mint glow #a7f3d0. Mix theo độ cao dải.
- Thêm "star dust": noise threshold 0.985 → vài chục điểm sáng tĩnh nhấp nháy chậm.
- Bottom glow xanh teal nhẹ tạo cảm giác chân trời cực quang.

### 3. Obsidian Ink — "Mực loang trên giấy"
- Giấy: thêm **paper grain texture** procedural (hash noise alpha 4%) + 1 lớp fiber lines mảnh chéo.
- Mực: chuyển từ radial gradient tròn → **shape có cạnh răng cưa** dùng turbulence offset trên đường tròn (perlin-perturbed circle) → dáng loang thật.
- Thêm **wet edge**: viền tối hơn 8% ở rìa blot (dark ring) như mực ướt vừa khô.
- Spawn rare "drip": 1/4 blot có 1 vệt dài 30–80px xuống dưới (Bezier mảnh dần) → wow moment.
- Bảng màu giấy ấm hơn: base #f4f0e6, sumi ink #1a1410.

### 4. Digital Constellation — "Mạng sao số"
- Tăng lên 110 điểm, thêm **3 lớp parallax** thật (z-bands gần/giữa/xa) với tốc độ khác nhau.
- Links: chỉ vẽ trong cùng z-band hoặc band kề → giảm noise, hình thành cụm rõ.
- Thêm **pulse waves**: mỗi 7s, một điểm random phát sóng tròn lan ra, các link trong bán kính sáng lên rồi tắt dần. (1 wave active tại một thời điểm.)
- Bảng màu: base gradient #06091a → #0c1530, sao cyan-white #dbe9ff, accent link #6ea8ff khi pulse.
- Subtle starfield tĩnh background (50 dot 1px alpha rất thấp) cho cảm giác sâu.

### 5. Neon Vapor — "Phố Neon"
- Phối lại palette vaporwave thật sự: deep purple #1a0533 → hot magenta #ff2e93 → cyan #00d9ff → soft pink #ffb3d9.
- Thay scanlines hiện tại (sin gl_FragCoord.y) bằng **CRT scanlines + chromatic aberration** nhẹ ở mép.
- Thêm **horizon sun**: một bán nguyệt gradient hot pink→cyan ở y=0.42 với các đường ngang cắt (Tron-grid feel).
- Thêm **grid floor** dưới horizon: perspective lines hội tụ về tâm, fade theo khoảng cách (procedural, không texture).
- Bloom giả lập bằng pow(col, 1.1) + add lại 0.15 highlights.

### 6. Terminal Boot — "Quét CRT phosphor"
- Glyph set: thêm chữ Hán/Hangul + Latin nhỏ → đa dạng hơn katakana.
- **Head glow**: ký tự đầu mỗi cột không chỉ trắng-xanh mà có halo (vẽ 2 lần, lần 2 alpha 0.3, blur giả bằng shadowBlur 6).
- **Boot text overlay**: mờ ở giữa canvas, cuộn từng dòng "BOOT OK / MEM 64K / LOAD KERNEL..." (~12 dòng, fade out sau 8s khi mount, không lặp) — wow moment khởi động.
- Thêm **scanline overlay** ngang full-canvas (alpha 4%) + **vignette CRT** cong nhẹ ở 4 góc.
- Đôi lúc (1/60 frame) flicker toàn màn hình bằng overlay alpha 6% — hồn vía CRT cũ.
- Tăng FPS cap lên 24fps (mượt hơn) nhưng vẫn lightweight.

## Phần C — Tài sản & registry

- Cập nhật swatch trong `SCENE_REGISTRY` cho khớp palette mới (giúp preview chip trong dropdown sát thật hơn):
  - cyber-linh-khi: `#01030a` → `#5eead4`
  - ethereal-aurora: `#1a0a3a` → `#fbcfe8`
  - obsidian-ink: `#f4f0e6` → `#1a1410`
  - digital-constellation: `#06091a` → `#dbe9ff`
  - neon-vapor: `#1a0533` → `#00d9ff`
  - terminal-boot: `#020402` → `#beffc8`
- `pixelDiffRatio` / `chromeDiffRatio`: giữ nguyên giá trị hiện tại; nếu visual regression test fail sẽ điều chỉnh +0.005 từng scene (chỉ scene fail).

## Phần D — Kiểm chứng

1. Build sạch (TS, ESLint).
2. Chạy `e2e/home-scenes-visual.spec.ts`; nếu fail do nâng cấp thị giác → cập nhật baseline cho scene tương ứng.
3. Kiểm thủ công 6 scene trên `/`: chuyển qua lại, không flicker, fade-in mượt, không leak WebGL context.
4. Kiểm `SceneToggle` chỉ hiện ở `/`, không hiện ở `/note/:slug`.
5. Kiểm `ThemeToggle` (icon Sun/Moon) chỉ còn 3 mục.

## Chi tiết kỹ thuật

**File mới:**
- `src/components/SceneToggle.tsx`
- `src/components/__tests__/SceneToggle.i18n.test.tsx`

**File sửa:**
- `src/components/ThemeToggle.tsx` (gỡ scene logic, còn 3 mục)
- `src/pages/Home.tsx` (thêm `<SceneToggle />` trước `<LanguageToggle />`)
- `src/components/__tests__/ThemeToggle.i18n.test.tsx`
- `src/i18n/index.ts` (3 key mới × vi/en)
- `src/components/home/scenes/cyber-linh-khi.frag.ts`
- `src/components/home/scenes/ethereal-aurora.frag.ts`
- `src/components/home/scenes/neon-vapor.frag.ts`
- `src/components/home/scenes/ObsidianInk.tsx`
- `src/components/home/scenes/DigitalConstellation.tsx`
- `src/components/home/scenes/TerminalBoot.tsx`
- `src/components/home/scenes/registry.ts` (cập nhật swatch)

**Không đụng:** `SceneHost.tsx`, `use-scene-theme.ts`, `SceneProps` contract, vite manual chunks, CI scripts.
