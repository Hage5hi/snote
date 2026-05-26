# Hoàn thiện theme system — 5 scene + đổi tên + token cleanup

Phạm vi: đổi tên 5 scene theo prompt, nâng cấp visual cho 5 scene (Jade Chi, Cực Quang Mộng, Mực Hắc Diệu, Cung Hoàng Đạo, Terminal Boot). **Neon Vapor giữ nguyên** (không nằm trong feedback). Không thêm tính năng. Isolation `/` ↔ `/:slug` và guardrails WebGL là bất khả xâm phạm.

## A. Đổi tên + thứ tự (registry + i18n)

`SCENE_REGISTRY` giữ ID kỹ thuật cũ (tránh vỡ localStorage `home.scene` của user hiện tại, vỡ visual baseline E2E, vỡ token blocks trong `index.css`). **Chỉ đổi label hiển thị** qua i18n. Thứ tự dropdown sắp lại đúng prompt:

1. `cyber-linh-khi`           → EN "Jade Chi"          / VI "Jade Chi"
2. `ethereal-aurora`          → EN "Ethereal Aurora"   / VI "Cực Quang Mộng"
3. `obsidian-ink`             → EN "Obsidian Ink"      / VI "Mực Hắc Diệu"
4. `digital-constellation`    → EN "Zodiac Constellation" / VI "Cung Hoàng Đạo"
5. `neon-vapor`               → giữ nguyên label hiện tại
6. `terminal-boot`            → EN "Terminal Boot" / VI "Terminal Boot"

Sửa `src/i18n/index.ts` (`scene.*.label` + `scene.*.desc` cho 4 scene đổi tên). Cập nhật snapshot test `SceneToggle.i18n.test.tsx` nếu cần. Sắp lại `SCENE_REGISTRY` array đúng thứ tự trên (mục `none` đứng đầu).

## B. Token refactor (chốt cuối)

Token infra đã có sẵn (`[data-home-root][data-scene="..."]` blocks trong `src/index.css`, Home.tsx dùng inline `style={{ background: "var(--home-...)" }}`). Việc cần làm:

1. Audit `Home.tsx` tìm class Tailwind màu cứng còn sót (`text-teal-*`, `border-cyan-*`, `bg-black/40`, ...). Theo kiểm tra hiện tại Home.tsx đã dùng vars; chỉ cần xác nhận và thay nếu còn sót.
2. Bổ sung 3 token chuẩn hoá cho mọi scene block (nếu thiếu): `--home-accent`, `--home-accent-soft`, `--home-hairline`. Dùng làm alias trỏ tới giá trị đã có (`--home-row-hover-ring`, `--home-recents-divider`, ...) để các scene block đồng nhất API.
3. Chạy `bun run check:home-isolation` xác nhận không leak.

## C. Nâng cấp 5 scene

### C1. Jade Chi — `cyber-linh-khi.frag.ts` (force dark)

Vấn đề: hiện ra như "cloud blobs". Sửa shader theo hướng "dải khí cuộn":

- **Domain warp 2 pass**: `p = p + 0.6 * fbm(p + fbm(p))` → bẻ field thành dải dài thay vì cụm tròn.
- **Flow band mask**: dùng `band = abs(sin(p.y * 1.4 + warp.x * 2.0))` lấy power 0.5 → tạo 2–3 dải ngang cuộn dọc canvas.
- **Tăng noise scale** (giảm tần số): octave 4 thay 5, lacunarity 2.1, gain 0.55 → cấu trúc to hơn, ít hạt nhỏ.
- **Base sâu hơn**: `#01030a` (gần đen) thay base hiện tại; jade peak `hsl(168 85% 55%)` chỉ chạm ở đỉnh dải (`smoothstep(0.55, 0.85, band)`).
- **Shimmer**: `sin(time*0.7 + p.x*3.0) * 0.04` cộng vào kênh G ở vùng peak → ngọc bích lấp lánh chậm.
- **Vignette + grain 6%** giữ nguyên.

Swatch update: `["#01030a", "#5eead4"]`.

### C2. Cực Quang Mộng — `ethereal-aurora.frag.ts` (force dark)

Vấn đề: "chưa mộng cho lắm". Sửa:

- **Base tối hơn**: `#0a0518` (deep indigo near-black) thay vì pha tím sáng hiện tại.
- **Slow drift**: chia `iTime` xuống 0.35× (hiện ~0.6×). Tốc độ FBM giảm → cảm giác trôi mơ.
- **Soft pastel bands (3 lớp curl-noise)**: width feather 0.18 (rộng hơn), saturation -15% (`mix(color, vec3(luma), 0.15)`) → màu nhạt, ethereal.
- **Deeper blend**: dùng `screen` blend giữa 3 dải thay `add` → màu tan vào nhau, không bệt.
- **Sparkle noise**: `hash(floor(p*120.))` threshold > 0.992 → ~30 điểm sáng tĩnh nhấp nháy chậm (`sin(time*0.4 + hash*6.28)*0.5+0.5`), alpha tối đa 0.6. Tạo "stardust mộng".
- **Bottom teal glow** giữ.

Swatch: `["#0a0518", "#fbcfe8"]`.

### C3. Mực Hắc Diệu — `ObsidianInk.tsx` (force light, Canvas2D)

Vấn đề: blot trông như "vi khuẩn". Viết lại thuật toán hoàn toàn — **bỏ noisy circles**, dùng **structured SDF ink diffusion**:

- **Blot shape**: mỗi blot là polygon SDF gồm 8–12 điểm đặt trên đường tròn, mỗi điểm offset bằng `radius * (0.85 + 0.3 * valueNoise(angle*2, seed))` → cạnh răng có cấu trúc, không nhiễu chấm.
- **Multi-radius diffusion rings**: vẽ 3 lớp đồng tâm với alpha giảm dần (core 0.92, mid 0.45, halo 0.18) và radius nhân (1.0, 1.35, 1.9) → tạo gradient khuếch tán giấy.
- **Wet edge dark ring**: vòng alpha 0.12 tối hơn 8% ở `radius * 1.05` → viền ướt vừa khô.
- **Paper grain**: lớp procedural noise alpha 4% pre-render 1 lần vào offscreen canvas, blit mỗi frame (không tính lại).
- **Fiber lines**: 40 line mảnh chéo random, alpha 3%, pre-render cùng grain.
- **Drip (rare)**: 1/5 blot spawn 1 vệt Bezier dài 40–90px xuống dưới, taper alpha.
- **Spawn cadence**: 1 blot mới mỗi 2.5–4s, max 7 blot đồng thời, fade-out sau 12s.
- Giữ FPS cap 12, pause-on-hidden, reduced-motion → render 1 static frame.

Palette giấy ấm hơn: bg `#f5f0e6`, ink `#1a1410`. Token block `obsidian-ink` trong index.css cập nhật ăn theo. Swatch: `["#f5f0e6", "#1a1410"]`.

### C4. Cung Hoàng Đạo — `DigitalConstellation.tsx` (force dark, Canvas2D)

Bỏ random points, vẽ **12 chòm sao Hoàng Đạo thật**:

- **Dữ liệu**: 12 chòm (Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpio, Sagittarius, Capricorn, Aquarius, Pisces). Mỗi chòm là array 5–9 điểm (x,y normalized 0–1) + array các cặp `[i,j]` cho cạnh nối. Toạ độ tự định nghĩa stylized, không cần chính xác thiên văn — đủ nhận diện hình tượng (ví dụ Leo có "sickle" 6 sao, Scorpio đuôi cong 9 sao).
- **Layout**: scatter 12 chòm trên canvas dạng grid lệch (4×3 hoặc spiral), mỗi chòm có anchor + scale 0.10–0.16 viewport, rotation jitter ±10°.
- **Render**: 
  - Stars: vẽ tròn 1.5–3px màu `#dbe9ff`, halo radial gradient 8px alpha 0.4.
  - Edges: đường nối `hsl(215 60% 70% / 0.25)`, width 0.7px.
  - Tên chòm (latin nhỏ, font-mono 9px, alpha 0.25) đặt cạnh anchor.
- **Parallax mouse drift**: 3 z-layer (4/4/4 chòm), offset = `mouse * [4px, 9px, 16px]`, lerp 0.08 mỗi frame.
- **Pulse**: mỗi 8s random 1 chòm, các star + edge của chòm đó pulse brightness theo `sin` 1.2s, decay → "kích hoạt cung hoàng đạo".
- **Background**: gradient `#06091a → #0c1530` + 60 starfield dot tĩnh 1px alpha 0.25.
- Pointer-events: none. Pause-on-hidden, reduced-motion → static (pulse off, parallax off).

Swatch: `["#06091a", "#dbe9ff"]`.

### C5. Terminal Boot — `TerminalBoot.tsx` (force dark, Canvas2D)

Thêm "high-quality details":

- **Blinking cursor**: track cột cuối cùng vừa render; vẽ block `█` ở vị trí ký tự cuối + 1, màu phosphor `#beffc8`, on/off mỗi 530ms.
- **Analog scanline grid**: overlay sau khi render glyphs — horizontal lines mỗi 3px alpha 6%, + faint vertical lines mỗi 2px alpha 2.5% → CRT grid rõ nhưng không chói.
- **Vignette CRT** cong 4 góc (đã có thì giữ).
- **Boot text overlay**: 12 dòng `BOOT OK / MEM 64K / LOAD KERNEL / ...` cuộn 1 lần khi mount, fade out sau 8s (không lặp).
- **Glyph set mở rộng**: thêm Hangul + một số CJK strokes ngoài katakana.
- **Head glow halo**: ký tự đầu mỗi cột vẽ 2 lần (lần 2 alpha 0.3, `shadowBlur 6`).
- **FPS cap 24** (hiện 18 hoặc 20 — tăng).

Token block `terminal-boot`: đảm bảo `--home-mono-family` set monospace cứng (đã có). Confirm Home UI dùng `font-mono` qua var khi scene này active. Swatch: `["#020402", "#beffc8"]`.

### C6. Neon Vapor — **không đổi** (không có feedback trong prompt).

## D. Guardrails (giữ nguyên, verify)

- `prefers-reduced-motion`: tất cả scene → 1 static frame, không rAF loop.
- `eink` media query: SceneHost trả null.
- `hardwareConcurrency < 4` + không `lightweight`: SceneHost trả null (Jade Chi, Cực Quang Mộng, Neon Vapor bị chặn; Mực Hắc Diệu, Cung Hoàng Đạo, Terminal Boot lightweight=true vẫn chạy).
- Pause-on-hidden qua `paused` prop.
- WebGL fallback `e2e/webgl-fallback.spec.ts` phải pass.
- Vitest hiện hành phải pass (SceneHost test, i18n test, ThemeToggle test, SceneToggle test).

## E. Visual regression baselines

`e2e/home-scenes-visual.spec.ts` chắc chắn fail cho 5 scene đã đổi. Sau khi build sạch:
1. Chạy local: `bun run e2e:scenes` (hoặc playwright update-snapshots cho file đó).
2. Update baseline cho `cyber-linh-khi`, `ethereal-aurora`, `obsidian-ink`, `digital-constellation`, `terminal-boot`.
3. Giữ nguyên baseline `neon-vapor` + `none`.
4. Nếu một scene fail vì AA jitter rìa, nâng `pixelDiffRatio` thêm +0.005 (chỉ scene đó).

## F. File touch list

**Sửa:**
- `src/i18n/index.ts` (label + desc 4 scene đổi tên × vi/en)
- `src/components/home/scenes/registry.ts` (thứ tự + swatch mới cho 5 scene)
- `src/components/home/scenes/cyber-linh-khi.frag.ts`
- `src/components/home/scenes/ethereal-aurora.frag.ts`
- `src/components/home/scenes/ObsidianInk.tsx` (rewrite blot algorithm)
- `src/components/home/scenes/DigitalConstellation.tsx` (rewrite → 12 chòm)
- `src/components/home/scenes/TerminalBoot.tsx` (thêm cursor + scanline grid + glyph set + halo)
- `src/index.css` (cập nhật giá trị token cho 5 scene để khớp palette mới; thêm alias `--home-accent` nếu cần)
- `src/components/__tests__/SceneToggle.i18n.test.tsx` (label snapshot mới)
- E2E baselines của 5 scene

**Không đụng:** `SceneHost.tsx`, `use-scene-theme.ts`, `Home.tsx` (trừ khi audit phát hiện màu cứng còn sót), `ThemeToggle.tsx`, `NeonVapor.tsx` + `neon-vapor.frag.ts`, scripts isolation, vite chunks.

## G. Verification checklist

1. `bun run check:home-isolation` pass.
2. `bun run test` (vitest) pass — đặc biệt i18n coverage + SceneToggle snapshot.
3. Build TS+ESLint sạch.
4. Manual `/`: chuyển 6 scene liên tiếp, không flicker, không leak WebGL context (`webgl-lost` không fire), fade-in mượt.
5. Manual `/note/test`: không có `data-scene`, không có token `--home-*`, không bị ảnh hưởng bởi scene đang active.
6. Reduced-motion ON: mỗi scene render 1 frame tĩnh, không rAF.
7. E2E `home-scenes-visual` + `webgl-fallback` + `i18n` pass với baselines mới.

Used the redesign skill.
