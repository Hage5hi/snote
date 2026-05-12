
# Syrin Notes — Final Upgrade Plan (v3, "synced instantly" priority)

> Đã chốt: critique v2 thắng v1. Re-order theo ưu tiên thực tế của bạn — **"synced instantly" UX > tất cả phần còn lại**, **"offline không quan trọng"** (gác PWA), **"local-first whenever possible"** (giữ Snapshots/Diff trong IndexedDB, không đẩy cloud).

---

## 0. Nguyên tắc chỉ đạo (mới)

1. **Synced instantly UX > sync speed**: sync đã instant rồi (50–300ms qua Supabase Realtime). Phần thiếu là **feedback** (SyncIndicator, conflict/recovered event). Không thay đổi sync architecture.
2. **Local-first whenever possible**: bất cứ data nào có thể sống ở client thì để IndexedDB / localStorage. Snapshots, Diff history, recent slugs, scroll position, view-mode preferences, undo stack → **không sync, không upload**. Chỉ `ydoc_state` + `note_shares` + `note_images` lên cloud.
3. **Offline gác lại**: không làm PWA / Service Worker / offline.html trong scope này (y-indexeddb đã đủ cho "gõ khi mất mạng"). Manifest đã có sẵn → user vẫn "Add to Home Screen" được.
4. **Bundle hard gate**: initial chunk route `/` delta ≤ 5 KB mỗi phase, grep `mermaid|katex|hljs|vim` trên initial bundle = 0 match.
5. **Lovable canvas inviolable**: không sửa `lovable-tagger`, `@vitejs/plugin-react-swc`, `src/integrations/supabase/{client,types}.ts`, `supabase/config.toml` project-level. Edge Functions thêm function-block là OK.

---

## 1. Lộ trình 7 phase (đã re-order)

```text
P0 Baseline (30 phút, không code)
   ↓
P1 Foundations  (i18n + CSS + deps + vite chunks)
   ↓
P2 Sync state UI  ⭐ ưu tiên cao nhất
   ↓
P3 Editor power  (mermaid/katex/hljs lazy + worker + vim + templates)
   ↓
P4 Share polish + Home onboarding
   ↓
P5 Image pipeline  (simplified: 0 Edge Function)
   ↓
P6 Tests + CI
   ↓
[P7 PWA — OPTIONAL, gác lại]
[Tier/Billing — KHÔNG làm]
```

---

### Phase 0 — Baseline (~30 phút, KHÔNG code)

Mục tiêu: có số liệu khách quan để so sánh ở mỗi phase sau.

- `bun run build` → ghi size mọi chunk vào `docs/baseline.md`.
- `ANALYZE=1 bun run build` với `rollup-plugin-visualizer` (devDep tạm) → ghi initial bundle route `/` = X KB.
- Lighthouse mobile 4G throttled → ghi PWA/Performance/Accessibility score.
- Đo sync latency hiện tại: mở 2 tab cùng slug, gõ ở tab A, đo `broadcast→apply` ở tab B (dùng `console.time` tạm trong `provider.ts`). Ghi p50/p95.
- Output: `docs/baseline.md` commit luôn.

---

### Phase 1 — Foundations (rủi ro: rất thấp)

- `package.json`: thêm `mermaid`, `katex`, `highlight.js`, `@types/katex`, `@replit/codemirror-vim`, `fuse.js`, `date-fns`, `framer-motion`, `tw-animate-css`, `fake-indexeddb` (dev), Radix bổ sung (`accordion`, `aspect-ratio`, `context-menu`, `hover-card`, `navigation-menu`). Bump `next-themes` ^0.4. Check `@lovable.dev/cloud-auth-js` 0.0.3 → 1.1.x (chỉ bump nếu changelog không breaking).
- `src/i18n/index.ts`: port toàn bộ key Replit (109 → ~1219 dòng). Diff theo namespace `home/topbar/share/templates/errors`. Chỉ thêm key, không xoá.
- `src/index.css`: thêm CSS vars `--kb-inset`, `--sa-{top,right,bottom,left}`, class `.zen-topbar`, `.lift-bottom`, `.animate-swipe-nudge`, `@keyframes swipe-nudge`.
- `src/hooks/use-visual-viewport.ts`: port mới.
- `vite.config.ts`: thêm `manualChunks` cho `mermaid-vendor`, `katex-vendor`, `hljs-vendor` (chunk rỗng đến khi P3 import).

**Verify:** build sạch, bundle initial **không tăng** (deps mới chưa được import), toggle EN/VI không key fallback.

---

### Phase 2 — Sync state UI ⭐ (rủi ro: thấp, value: cao nhất)

> **Re-frame:** Không làm sync nhanh hơn — sync đã instant. Mục tiêu là cho user **thấy** trạng thái sync theo thời gian thực.

#### 2.1 — Mở rộng `src/lib/yjs/provider.ts` (chỉ thêm, không sửa logic broadcast/snapshot)
```ts
export type SyncEvent =
  | { kind: "error"; message: string; at: number }
  | { kind: "conflict"; at: number }
  | { kind: "recovered"; at: number; bytes: number };

// Add private state:
//   pendingBytes: number       — tăng trong handleDocUpdate, reset sau saveSnapshot ok
//   hasUnflushedLocalChanges: boolean
//   lastBroadcastAt / lastSnapshotAt: number | null
//   eventListeners: Set<(e: SyncEvent) => void>
// Add public API:
//   onSyncEvent(cb), getPendingBytes(), getLastBroadcastAt(), getLastSnapshotAt()
// Critical: refetchDbSnapshot so sánh state vector pre/post → emit `recovered`
//   chỉ khi state thực sự khác local (tránh false positive).
```

#### 2.2 — Tách SaveStatus thành 2 trạng thái
- `editing` → khi có local change chưa broadcast.
- `synced-peer` → broadcast ok nhưng snapshot chưa flush (debounce 800ms).
- `synced-durable` → snapshot vào Postgres xong.
- Lý do: cho user thấy "peer-to-peer instant" ngay <50ms, không phải chờ snapshot.

#### 2.3 — `src/hooks/use-sync-status.ts` + `src/components/note/SyncIndicator.tsx`
- Pill nhỏ trong topbar, 4 trạng thái: 🟢 Synced / 🟡 Syncing / 🔵 Offline / 🔴 Error.
- Click → popover hiện: pending bytes, last broadcast/snapshot time, last error.
- **KHÔNG** làm `OfflineBanner` (anh nói offline không quan trọng).

#### 2.4 — Dev mode latency log
- Trong `provider.ts` chỉ khi `import.meta.env.DEV`: `console.log('[sync] broadcast→apply:', ms)` mỗi remote apply.
- Verify với 2 tab: p95 < 500ms = đạt.

#### 2.5 — Broadcast batching (làm)
```ts
// Gom các update trong cùng 1 frame, merge bằng Y.mergeUpdates, broadcast 1 lần.
// Thêm latency ~16ms (không cảm nhận được), giảm 90% chatter, an toàn pin mobile + free tier rate limit.
```

**Verify Phase 2:**
- 2 tab cùng slug → gõ tab A → tab B thấy text + indicator chuyển `syncing → synced-peer → synced-durable` < 500ms p95.
- Disconnect network → pill chuyển Offline; reconnect → tự sync + emit `recovered` nếu state khác.
- Burst typing 30/s → Network panel thấy ≤ 5–10 messages/s (không phải 30+).

---

### Phase 3 — Editor power (rủi ro: thấp-trung, value: cao)

6 sub-commit:

| Sub | Module | Ghi chú |
|---|---|---|
| 3.1 | `lib/markdown-extensions.ts` + LRU cache (200 entries) + lazy `mermaid`/`katex`/`hljs` + inject CSS theme | Wire vào `Preview.tsx`. Grep dist initial = 0 match. |
| 3.2 | `workers/render.worker.ts` + `workers/render-engine.ts` + `lib/render-pipeline.ts` + `lib/worker-render-client.ts` | `new Worker(new URL(...), { type: 'module' })`; `renderTokenRef` cancel stale; MutationObserver re-render khi đổi theme. |
| 3.3 | `lib/templates.ts` + cập nhật `lib/slash-commands.ts` | 4 template (meeting/journal/todo/daily) với `{{cursor}}`. |
| 3.4 | `lib/paste-warn.ts` + AlertDialog trong `Editor.tsx` | Ngưỡng 50 KB. |
| 3.5 | `hooks/use-vim-mode.ts` + Compartment trong `Editor.tsx` + toggle 1 dòng `DropdownMenuCheckboxItem` trong `topbar/SettingsMenu.tsx` hiện có | Lazy import `@replit/codemirror-vim`. Không split menu lại. |
| 3.6 | `lib/wiki-link-expand.ts` + nâng `wiki-link-completion.ts` dùng `fuse.js` fuzzy; `lib/table-nav.ts` đã có sẵn — verify dùng đúng | Tab navigate cell; `[[` autocomplete fuzzy. |

**Cập nhật `lib/export.ts`** sau 3.1: pipeline export PDF/HTML chạy qua cùng renderer để Mermaid/KaTeX/code colors xuất hiện đúng.

**Verify:**
- Initial bundle delta ≤ 5 KB (so `docs/baseline.md`).
- `grep -E 'mermaid|katex|hljs|@replit/codemirror-vim' dist/assets/index-*.js` = 0 match.
- Manual: `/template meeting`, paste 100KB → dialog, vim `:w`, `[[fuzzy]]`, ` ```mermaid `, `$x^2$`, code highlight light+dark, đổi theme → diagram re-render đúng.

---

### Phase 4 — Share polish + Home onboarding (rủi ro: trung, value: cao)

**Migration (file format `YYYYMMDDHHMMSS_<uuid>_<slug>.sql`):**
```sql
ALTER TABLE public.note_shares
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS note_shares_expires_at_idx
  ON public.note_shares(expires_at) WHERE expires_at IS NOT NULL;
```

**Edge Functions:**
- `share-update` (mới): UPDATE atomic `expires_at`. Không revoke.
- `share-status` (mới): trả `{ token, expires_at, view_count, last_viewed_at }`.
- `share-view` (sửa file hiện có): trả **HTTP 410 Gone** nếu `expires_at < now()`; `UPDATE … SET view_count = view_count + 1, last_viewed_at = now() WHERE token = $1 RETURNING …` 1 round-trip. Dedupe view: in-memory Map `{ip+token → lastViewedAt}` TTL 5 phút.

**Frontend:**
- `components/note/ShareDialog.tsx`: combo expiry `1h / 24h / 7d / 30d / Never`. Hiện `view_count` + `last_viewed_at` (relative time qua `date-fns`). Poll `share-status` 30s khi dialog mở.
- `pages/SharePage.tsx`: bắt 410 → empty state "Link đã hết hạn".
- `pages/Home.tsx`: `useSearchParams` cho `?tag=`, popular tags chips top 8, slug availability check debounced (Supabase trực tiếp). Empty state khi `recents.length === 0`: 4 template card **dynamic import** (không phình bundle route `/`).

**Verify:**
- Set expiry 1 phút → đợi → `/s/:token` trả 410.
- 2 tab cùng slug đổi expiry tab A → tab B thấy trong ≤30s.
- F5 trong 5 phút → view_count không tăng.
- Bundle route `/` delta ≤ 5 KB.

---

### Phase 5 — Image pipeline (simplified, rủi ro: thấp, 0 Edge Function)

**Tiền đề:** ảnh trong note app slug-as-key đã anonymous, **public bucket** là chuẩn. Không cần signed URL, không cần Edge Function.

**Bật `pg_cron` + `pg_net` trong Cloud → Database → Extensions trước khi apply migration.**

**Migration:**
```sql
-- Public bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('note-images', 'note-images', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can upload (size <= 5MB enforced at app + storage)
CREATE POLICY "Public upload note images" ON storage.objects
  FOR INSERT TO public WITH CHECK (bucket_id = 'note-images');

CREATE POLICY "Public read note images" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'note-images');

-- Tracking table
CREATE TABLE IF NOT EXISTS public.note_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL REFERENCES public.notes(slug) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_referenced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.note_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public insert image record" ON public.note_images
  FOR INSERT TO public WITH CHECK (true);
CREATE INDEX note_images_slug_idx ON public.note_images(slug);
CREATE INDEX note_images_last_ref_idx ON public.note_images(last_referenced_at);

-- Cleanup function + cron 6h
CREATE OR REPLACE FUNCTION public.cleanup_orphan_note_images()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT storage_path FROM public.note_images
    WHERE last_referenced_at < now() - interval '24 hours'
  LOOP
    DELETE FROM storage.objects WHERE bucket_id = 'note-images' AND name = r.storage_path;
  END LOOP;
  DELETE FROM public.note_images WHERE last_referenced_at < now() - interval '24 hours';
END $$;

SELECT cron.schedule('cleanup-orphan-note-images', '0 */6 * * *',
  $$ SELECT public.cleanup_orphan_note_images(); $$);
```

**Frontend:**
- `lib/image-upload.ts`: resize ≤ 1920px JPEG q=0.85 nếu > 500KB; `supabase.storage.from('note-images').upload(...)` trực tiếp; insert `note_images` row; return `getPublicUrl(...)`.
- `lib/image-render.ts`: IntersectionObserver lazy-load (chỉ cần `loading="lazy"` cũng đủ — eval xem có cần observer thật không).
- `lib/paste-image.ts`: CodeMirror paste handler, wire vào `Editor.tsx`.
- Reference tracking: khi save note, parse `note-images/...` URLs → `UPDATE note_images SET last_referenced_at = now() WHERE storage_path = ANY($1)` (batch).

**Verify:**
- Paste 3MB ảnh → resize ~500KB → upload → render trong Preview.
- Reload → ảnh vẫn hiện (public URL, không expire).
- Xoá hết reference trong note → đợi 24h+cron → bucket sạch.

---

### Phase 6 — Tests + CI (rủi ro: rất thấp)

Port từ Replit:
- `lib/__tests__`: `crypto`, `markdown-extensions`, `render-pipeline`, `render-engine`, `restore-snapshot`, `sync-state`, `templates`, `paste-warn`, `image-upload`.
- `components/note/__tests__`: `SyncIndicator`, `SnapshotDiff`, `preview-mermaid-theme`.
- `hooks/__tests__`: `use-sync-status`, `use-vim-mode`.
- `pages/__tests__`: `NotePage.mobile`, `Home.tag-filter`.

`src/test/setup.ts`: import `fake-indexeddb/auto`, `@testing-library/jest-dom`.

CI: cập nhật `.github/workflows/ci.yml` thêm `bunx vitest run` gate trên PR.

---

### Phase 7 — PWA (OPTIONAL, GÁC LẠI)

Không làm. Nếu sau này đổi ý:
- `VitePWA({ registerType: "prompt", devOptions: { enabled: false } })` + guard `inIframe || /id-preview--|lovableproject\.com/.test(hostname)` → unregister thay vì register.
- `public/sw.js` kill-switch (skipWaiting + claim + caches.delete + unregister) chuẩn bị sẵn để rollback nếu deploy lỡ.
- KHÔNG cần `offline.html` cầu kỳ; manifest đã có sẵn cho Add-to-Home.

---

### Tier / Billing — KHÔNG làm

Q2=A đã chốt. Bỏ Lemon Squeezy / Stripe / `users` table tuỳ chỉnh / `quotas_log` / `note_events` audit / `webhook_events`.

---

## 2. Áp dụng nguyên tắc Local-First (đối chiếu code hiện tại)

| Data | Hiện tại | Quyết định |
|---|---|---|
| Note content | Yjs + Postgres `ydoc_state` | Sync (cần) |
| Snapshots (10 versions) | `src/lib/snapshots.ts` → IndexedDB | **Giữ local**, không sync |
| Recent slugs | localStorage | **Giữ local** |
| Word goal, view modes, zen/eink/typewriter prefs | localStorage / IndexedDB | **Giữ local** |
| Vim mode preference (Phase 3.5) | sẽ thêm localStorage | **Local** |
| Scroll position theo slug | localStorage | **Giữ local** |
| Tag filter, search query | URL params + state | **Không persist** |
| note_shares + view_count | Postgres | Cần shared (nhiều device) |
| note_images metadata | Postgres | Cần (cleanup cron) |

→ Không có gì cần đổi flow hiện tại. Khi thêm preference mới trong Phase 3–4: mặc định localStorage trước, chỉ lên cloud nếu **rõ ràng** cần đa-device.

---

## 3. Tiêu chí build/release mọi phase

1. `bun run build` không lỗi, không warning mới.
2. Bundle initial route `/` so với `docs/baseline.md`: delta ≤ 5 KB.
3. `grep -E 'mermaid|katex|hljs|@replit/codemirror-vim' dist/assets/index-*.js` = 0 match (sau P3).
4. Smoke 4 flow: tạo note → gõ → share link → mở link (cả expired + valid sau P4).
5. Lovable canvas preview: edit-in-canvas vẫn hoạt động (không có SW active).
6. Giữ 5 pre-existing typecheck warning (`App.tsx` future flag, `ShareDialog` qrcode, `StatusPill` JSX, `calendar` buttonVariants, `paste-markdown` turndown) — KHÔNG tự sửa kèm.

---

## 4. Migration filename format

Theo convention repo hiện tại: `YYYYMMDDHHMMSS_<uuid?>_<slug>.sql`. Migrations sẽ thêm:
- `20260512XXXXXX_share_polish.sql` (P4)
- `20260512XXXXXX_note_images.sql` (P5)

Cùng với pg_cron schedule (chạy sau khi extension đã enable).

---

## 5. Mốc deliverable

- **Block 1 (P0 + P1 + P2)** — Foundations + Sync UX. **1–1.5 tuần**. *Đây là block giá trị cao nhất theo ưu tiên của bạn.*
- **Block 2 (P3)** — Editor power, 6 sub-PR. **~1 tuần**.
- **Block 3 (P4)** — Share + onboarding. **3–5 ngày**.
- **Block 4 (P5)** — Image pipeline simplified. **2–3 ngày**.
- **Block 5 (P6)** — Tests + CI. **2–3 ngày**.
- Tổng: **~3.5–4 tuần** đầy đủ. **Có thể dừng sau P3** và app đã rất tốt.

---

## 6. Bắt đầu

Mặc định: chạy **P0 (baseline)** ngay sau khi bạn approve plan này, rồi tuần tự P1 → P2.

Nếu bạn muốn jump thẳng vào P2 (Sync UX) bỏ qua P1 trước cũng được — chỉ là sẽ phải làm i18n + deps trong cùng commit lớn hơn. Báo tôi khi approve.
