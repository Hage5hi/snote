

## Performance Overhaul: nhanh, mượt, bundle nhỏ

Mục tiêu: app cảm giác "instant" — mở/chuyển/tạo note <100ms perceived, gõ phím không jank kể cả note dài, bundle giảm ~60%.

### Phase 1 — Dọn dependencies (tác động lớn nhất)

Gỡ deps không dùng (chưa import ở đâu trừ shadcn boilerplate):
- `three`, `@react-three/fiber`, `@react-three/drei` (~700KB)
- `recharts` (~400KB) + xoá `src/components/ui/chart.tsx`
- `react-day-picker`, `date-fns` (~150KB) + xoá `ui/calendar.tsx`
- `embla-carousel-react` + xoá `ui/carousel.tsx`
- `react-hook-form`, `@hookform/resolvers`, `zod` (nếu chỉ form dùng) + xoá `ui/form.tsx`
- `react-resizable-panels` (chỉ SplitView dùng — kiểm tra, nếu không thì gỡ + `ui/resizable.tsx`)
- `input-otp`, `vaul`, các Radix component không dùng (`menubar`, `navigation-menu`, `hover-card`, `context-menu`, `accordion`, `aspect-ratio`...) — xoá file UI tương ứng
- `@playwright/test` (chuyển sang devDeps nếu cần, hoặc gỡ)

Bỏ font Google blocking trong `index.css` → preload async hoặc dùng system font stack (Inter/Geist không thấy dùng trong Tailwind config — kiểm tra rồi gỡ).

**Kỳ vọng**: bundle giảm từ ~1.2MB → ~400-500KB. First load nhanh gấp 2-3 lần.

### Phase 2 — Code-splitting & vendor chunks

Trong `vite.config.ts` thêm `build.rollupOptions.output.manualChunks`:
- `react-vendor`: react, react-dom, react-router-dom
- `cm-vendor`: codemirror + @codemirror/* + y-codemirror.next
- `yjs-vendor`: yjs, y-indexeddb, y-protocols
- `md-vendor`: marked, dompurify (chỉ load khi mở Preview)
- `radix-vendor`: tất cả @radix-ui/*

Lazy-load `marked` + `dompurify` trong `Preview.tsx` (dynamic import) — Editor không cần render markdown.

### Phase 3 — Mở note nhanh hơn (giảm waterfall)

Hiện tại trong `NotePage`:
```
fetch enc-meta → setEncPhase("ready") → tạo provider → IDB sync → fetch ydoc_state → connect realtime
```
Tối ưu:
1. **Gộp 1 query**: fetch `is_encrypted, enc_salt, enc_check, ydoc_state` cùng lúc thay vì 2 round-trip.
2. **Mount editor ngay lập tức**: tạo `Y.Doc` + Editor song song với fetch enc-meta. Nếu encrypted → wrap editor bằng overlay UnlockForm thay vì block trắng. Cảm giác instant.
3. **IDB-first**: load IndexedDB snapshot trước (sync nhanh, ms), render content, rồi mới apply server snapshot khi về.
4. **Prefetch enc-meta + snapshot** trong `Home.prefetchSnapshot` (đã có cho ydoc_state, thêm enc_salt/enc_check).
5. **Skeleton "instant editor"** thay spinner: hiện CodeMirror rỗng + Topbar shell trong <50ms, content fade-in khi sẵn sàng.

### Phase 4 — Chuyển trang nhanh

1. **View Transitions API** (`document.startViewTransition`) khi navigate giữa note → cross-fade mượt thay vì flash trắng.
2. **Prefetch on hover** trong CommandPalette + Home (đã có 1 phần) — mở rộng cho mọi link slug.
3. **Keep-alive doc cache**: giữ `Y.Doc` của 3 note gần nhất trong memory (Map<slug, Doc>) — quay lại note vừa rời = 0ms.

### Phase 5 — Gõ phím mượt với note dài (virtualization)

CodeMirror đã virtualize sẵn, nhưng các observer hiện tại re-run mỗi keystroke trên toàn bộ text:
1. **Debounce word/char count** (rAF + 150ms) trong `NotePage.updateCounts`.
2. **Tag extract / outline parse**: chuyển sang `requestIdleCallback` với fallback timeout.
3. **Web Worker cho count + tag extract** khi text > 50.000 ký tự (note dài) — main thread không tốn cycle.
4. **`detectLang` trong Editor + Preview**: chỉ chạy 1 lần khi text length đổi >500 chars, không phải mỗi keystroke.
5. **Preview render**: debounce `marked.parse` 200ms khi gõ liên tục, dùng `requestIdleCallback`.

### Phase 6 — Background sync mượt

1. **Offline queue tự động**: provider hiện đã dùng IDB nên save offline OK; thêm explicit "queued/syncing" status trong StatusPill.
2. **Visibility API**: pause snapshot timer khi tab hidden, flush ngay khi visible.
3. **Beacon save**: dùng `navigator.sendBeacon` trong `beforeunload` thay vì sync supabase call (có thể bị browser kill).

### Phase 7 — Fixes phụ

- Sửa warning React Router (thêm future flags `v7_startTransition`, `v7_relativeSplatPath`).
- Sửa "Function components cannot be given refs" → wrap `SuspenseFallback` & toaster trong forwardRef hoặc đổi cấu trúc App.tsx.
- Gỡ các UI shadcn components không dùng để tree-shake triệt để.

### Files thay đổi (ước tính)

- ✏️ `package.json` — gỡ ~15 deps
- ✏️ `vite.config.ts` — manualChunks
- ✏️ `index.css` — bỏ Google fonts
- ✏️ `src/pages/NotePage.tsx` — gộp query, mount editor sớm, debounce counts
- ✏️ `src/pages/Home.tsx` — prefetch enc-meta + view transition
- ✏️ `src/components/CommandPalette.tsx` — prefetch on hover, view transition
- ✏️ `src/lib/yjs/provider.ts` — accept pre-fetched snapshot, beacon save
- ✏️ `src/components/note/Preview.tsx` — lazy load marked/dompurify, debounce
- ✏️ `src/components/note/Editor.tsx` — debounce detectLang
- ✏️ `src/components/note/OutlineSidebar.tsx` — rIC parse
- ➕ `src/lib/yjs/doc-cache.ts` — in-memory doc cache LRU
- ➕ `src/lib/text-stats.worker.ts` — worker count/tag (cho note dài)
- ➕ `src/components/note/EditorSkeleton.tsx` — instant skeleton
- ✏️ `src/App.tsx` — fix forwardRef warning + router future flags
- ❌ Xoá: `ui/chart.tsx`, `ui/calendar.tsx`, `ui/carousel.tsx`, `ui/form.tsx`, `ui/menubar.tsx`, `ui/navigation-menu.tsx`, `ui/hover-card.tsx`, `ui/context-menu.tsx`, `ui/accordion.tsx`, `ui/aspect-ratio.tsx`, `ui/input-otp.tsx`, `ui/drawer.tsx`, `ui/resizable.tsx` (nếu SplitView không dùng), `ui/sidebar.tsx`

### Kết quả kỳ vọng

| Metric | Trước | Sau |
|---|---|---|
| Bundle gzip | ~400KB | ~150KB |
| First Contentful Paint | ~800ms | ~300ms |
| Mở note có content | ~600ms | <150ms (IDB) / <300ms (server) |
| Chuyển note đã cache | ~400ms | ~0ms |
| Gõ phím trên note 50K từ | jank ~50ms | <16ms |

Không đổi UI hiện tại, không đụng schema database, không break feature nào.

