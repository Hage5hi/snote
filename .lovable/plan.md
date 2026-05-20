
# Plan — Syrin Notes Bling & Theme Selector

Mục tiêu: Dropdown "Theme" tinh tế trên Home, kiến trúc Scene Registry mở rộng cho cả 6 theme trong `theme.txt`, build sẵn duy nhất **Cyber Linh Khí** (OGL + Simplex Noise, cyan/jade) — chỉ load shader khi user chủ động chọn. Polish Home an toàn, không vượt bundle gate, không chạm NotePage / Editor / Preview / SW cache.

## 1. Kiến trúc hai trục theme

Tách bạch 2 axes — quan trọng để 6 scenes sau này tương thích cả light & dark mà không tạo combinatorial explosion:

```text
Color scheme axis  (next-themes)     →  light | dark | system
Scene axis         (mới, tự quản)    →  none | cyber-linh-khi | ...
```

- `next-themes` giữ nguyên cho light/dark (đã wired sẵn cả app, Editor/Preview dùng).
- Scene axis lưu ở `localStorage["home.scene"]`, default = `"none"`. Chỉ ảnh hưởng route `/` (Home) — các route khác bỏ qua hoàn toàn.

## 2. Scene Registry (extensibility hook)

File mới: `src/components/home/scenes/registry.ts`

```ts
export interface SceneDef {
  id: string;                              // "cyber-linh-khi"
  label: string;                           // i18n key hoặc literal
  swatch: [string, string];                // 2 hex cho preview chip trong dropdown
  enabled: boolean;                        // false = hiện "Coming soon", disabled
  load?: () => Promise<{ default: React.ComponentType<SceneProps> }>;
}
export const SCENE_REGISTRY: SceneDef[] = [
  { id: "none",            label: "scene.none",            swatch: [...], enabled: true },
  { id: "cyber-linh-khi",  label: "scene.cyber_linh_khi",  swatch: ["#0a2a26","#5eead4"], enabled: true,
    load: () => import("./CyberLinhKhi") },
  { id: "ethereal-aurora",  ..., enabled: false },   // 5 entries locked, 1-line add later
  { id: "digital-constellation", ..., enabled: false },
  { id: "obsidian-ink",     ..., enabled: false },
  { id: "neon-vapor",       ..., enabled: false },
  { id: "terminal-boot",    ..., enabled: false },
];
```

Thêm theme mới về sau = (1) đổi `enabled: true` (2) thêm `load: () => import("./X")` (3) tạo file scene tương ứng. Không touch ThemeToggle, không touch Home, không touch Vite config.

Hook: `src/hooks/use-scene-theme.ts` — `useSceneTheme(): { scene, setScene, def }`, đọc/ghi localStorage, broadcast qua `storage` event (đồng bộ multi-tab giống `pinned` đã có).

## 3. ThemeToggle → DropdownMenu tinh tế

File: `src/components/ThemeToggle.tsx` (refactor surgical, giữ vị trí header).

UX:
```text
[ ◐ ]  ← trigger: icon hiện tại + nhỏ caret xuống
   │
   ├── COLOR
   │   ◯ Light    [Sun icon]
   │   ● Dark     [Moon icon]
   │   ◯ System   [Monitor icon]
   ├── ─────────────
   ├── BACKGROUND SCENE  (chỉ render khi route = "/")
   │   ● None — minimal
   │   ◯ Cyber Linh Khí   [▮▮ cyan swatch]
   │   ◯ Ethereal Aurora  [▮▮]  Coming soon (disabled)
   │   ◯ ...
```

Implementation: dùng `@radix-ui/react-dropdown-menu` đã có sẵn trong deps + `DropdownMenuRadioGroup` cho 2 nhóm. Không thêm dep. Render Scene group có điều kiện `useLocation().pathname === "/"` để dropdown ngắn gọn ở các route khác.

i18n: thêm keys vào file locale (`theme.color.*`, `scene.*`, `scene.coming_soon`).

## 4. SceneHost (lazy mount, guards)

File: `src/components/home/SceneHost.tsx`

- Đọc `scene` từ `useSceneTheme()`. Nếu `"none"` → return null (zero cost).
- Lookup `SCENE_REGISTRY`, gọi `def.load()` qua `React.lazy` → render `<Suspense fallback={null}>`.
- Guards (đúng brief section 3.2): chạy trước cả `load()`:
  - `prefers-reduced-motion: reduce` → revert scene về `"none"` + toast nhẹ.
  - `document.documentElement.classList.contains("eink")` → revert.
  - `navigator.hardwareConcurrency < 4` hoặc `saveData` / `slow-2g` → revert, nhớ choice để không re-prompt.
- Pause render loop khi `visibilitychange` → hidden (truyền vào scene component).
- Wrapper: `pointer-events-none absolute inset-0 -z-10`.

## 5. Cyber Linh Khí scene (file scene đầu tiên)

File: `src/components/home/scenes/CyberLinhKhi.tsx` + `cyber-linh-khi.frag.ts` (GLSL string).

- Lib: **OGL** (`ogl@^1.0.11`, ~20KB gz) — thêm 1 dep duy nhất, đúng brief.
- Setup: full-viewport WebGL quad, fragment shader Simplex Noise 2D (snoise function inline trong GLSL).
- Uniforms: `u_time` (multiplier 0.0008, cực chậm), `u_resolution`, `u_dpr` (cap 1.5), `u_isDark` (đổi base color giữa light/dark).
- Color palette: jade `#14b8a6` → cyan `#5eead4` → rêu tối `#03110f`. Light theme: tăng luminance base + giảm opacity overlay để text vẫn AAA-readable.
- rAF loop với throttle 30fps (`if (now - last < 33) skip`), dừng khi tab hidden, dispose context khi unmount.
- WebGL feature detect: `if (!gl) → return null, log warn` (Hero3D vẫn an toàn).
- Edge case: WebGL context lost → listen `webglcontextlost`, dispose, revert scene về `"none"`.

## 6. Vite chunking + Bundle gate

`vite.config.ts` — thêm vào `manualChunks` và `resolveDependencies` (sau các rule hiện có):

```ts
// Mỗi scene → chunk riêng, không lên modulepreload
if (id.includes("/src/components/home/scenes/CyberLinhKhi")) return "scene-cyber-linh-khi";
if (id.includes("/ogl/") || id.includes("node_modules/ogl")) return "ogl-vendor";

// resolveDependencies filter (sửa regex hiện có):
!/(?:^|\/)(?:mermaid-vendor|katex-vendor|hljs-vendor|qrcode-vendor|chunk-a8f3|UnlockForm|wardley|scene-|ogl-vendor)-/.test(dep)
```

`scripts/check-bundle-size.ts` — thêm:

```ts
{ prefix: "ogl-vendor-",            label: "ogl-vendor",            maxGz: 22_000 },
{ prefix: "scene-cyber-linh-khi-",  label: "scene-cyber-linh-khi",  maxGz: 8_000  },
// FORBIDDEN_IN_PRELOAD += ["ogl-vendor", "scene-"]
```

SceneHost + Registry + ThemeToggle dropdown phải nằm trong entry — tổng ước ~2-3 KB gz tăng thêm (Radix DropdownMenu đã có sẵn, chỉ thêm code orchestration nhỏ). Vẫn dưới ngưỡng 75 KB entry và 250 KB initial total.

## 7. Visual polish Home (an toàn, no-FPS-cost)

Chỉ CSS / Tailwind, không thêm JS animation lib:

- **Hero typography**: H1 hiện tại `text-3xl md:text-4xl` → thêm `bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent` (text gradient tinh tế, hoạt động cả 2 mode). Tracking `-tracking-tight`.
- **Entrance animation**: `motion-safe:animate-fade-in` cho H1 + form + recents (stagger bằng `animation-delay` inline). Dùng keyframe `fade-in` đã khai báo sẵn trong `tailwind.config.ts`, 0 extra CSS.
- **Slug input**: thêm soft glow on focus — `focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]` thay vì ring cứng.
- **Pinned/Recent items**: nâng hover transition hiện có (đã có `motion-safe:hover:-translate-y-px`) thêm `hover:shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.15)]`.
- **Empty state**: nâng nhẹ icon container — gradient ring `ring-1 ring-border bg-gradient-to-b from-background to-muted/30`.

Tất cả gate qua `motion-safe:` để tôn trọng reduced-motion. Không animation chạy liên tục → 0 FPS cost.

## 8. Files & changes

```text
NEW    src/hooks/use-scene-theme.ts
NEW    src/components/home/SceneHost.tsx
NEW    src/components/home/scenes/registry.ts
NEW    src/components/home/scenes/CyberLinhKhi.tsx
NEW    src/components/home/scenes/cyber-linh-khi.frag.ts
EDIT   src/components/ThemeToggle.tsx            (button → DropdownMenu)
EDIT   src/pages/Home.tsx                        (mount <SceneHost/>, polish classes)
EDIT   src/i18n/<locale files>                   (thêm theme.* + scene.* keys, EN + VI)
EDIT   vite.config.ts                            (manualChunks + resolveDependencies)
EDIT   scripts/check-bundle-size.ts              (rules + FORBIDDEN_IN_PRELOAD)
EDIT   package.json                              (add "ogl": "^1.0.11")
EDIT   docs/architecture.md                      (1 section: Scene Registry)
NEW    src/components/home/__tests__/SceneHost.test.tsx  (smoke: guards revert, none → null)
```

KHÔNG chạm: `NotePage*`, `SplitView`, `RawView`, `SharePage`, `Editor.tsx`, `Preview.tsx`, `useTheme` callers trong editor, SW config, `next-themes` provider.

## 9. Verification gate

1. `bun run build:check` PASS — `ogl-vendor` và `scene-cyber-linh-khi` KHÔNG có trong modulepreload, total ≤ 250KB.
2. Mở `/` không chọn theme → DevTools Network: KHÔNG thấy `scene-cyber-linh-khi-*.js` hay `ogl-vendor-*.js`.
3. Chọn "Cyber Linh Khí" trong dropdown → 2 chunks load, shader render, Performance tab: rAF ~30fps, không long task >50ms.
4. Toggle light ↔ dark khi scene đang chạy → màu shader update đúng (`u_isDark`).
5. Reload `/scratch` (NotePage) → KHÔNG load scene chunk.
6. DevTools → Rendering → emulate `prefers-reduced-motion: reduce` → chọn scene → revert về None + scene chunk vẫn không load.
7. Tab inactive → rAF pause (CPU profile flat). Tab visible → resume.
8. Unit test smoke PASS.

## 10. Open questions (sẽ hỏi nếu chạm tới)

- Label tiếng Việt vs tiếng Anh cho scene names trong dropdown? **Default**: i18n keys, EN + VI cùng "Cyber Linh Khí" (tên riêng giữ nguyên VN).
- Chính sách khi user đã chọn scene rồi vào `prefers-reduced-motion`? **Default**: revert silent, không toast (tránh annoy).
- 5 theme còn lại hiện disabled — show "Coming soon" badge hay ẩn? **Default**: show disabled với badge — để bạn thấy roadmap.

