

# Pivot: Bug Tracker → Realtime Markdown Notes (Local-first + Yjs CRDT)

Tôi sẽ pivot toàn bộ dự án thành web app note online, xoá hết code bug tracker / auth / sidebar không liên quan.

## Kiến trúc đồng bộ (cốt lõi)

```text
   ┌──────────────┐  keystroke (0ms)  ┌───────────────┐
   │   Editor     │ ─────────────────►│   Y.Doc       │
   │ (CodeMirror) │                   │  (in-memory)  │
   └──────────────┘                   └───────┬───────┘
          ▲                                   │
          │ render                            ├──► IndexedDBPersistence (y-indexeddb)
          │                                   │       → lưu local tức thì, offline-first
          │                                   │
          │ remote updates                    └──► Supabase Realtime Broadcast
          └───────────────────────────────────────  (kênh: note:<slug>, gửi Y.update binary)
                                                    + Awareness (presence + cursor màu)
                                                    
   Snapshot định kỳ (debounce 800ms khi idle):
     Y.encodeStateAsUpdate(doc) → base64 → upsert vào bảng `notes`
     → bootstrap nhanh khi mở note lần đầu trên thiết bị mới
```

**Vì sao không dùng y-websocket server:** Lovable không host Node server riêng. Dùng **Supabase Realtime Broadcast** làm transport cho Y.js updates (binary → base64) — vẫn đạt độ trễ ~50–150ms, đồng bộ P2P qua kênh, không cần server Yjs. Snapshot toàn bộ doc định kỳ vào Postgres để bootstrap thiết bị mới.

## Routing

- `/` → trang home: input "Mở/tạo note", danh sách note đã truy cập (local), nút "Note ngẫu nhiên"
- `/:slug` → mở note (tự tạo nếu chưa có). Slug hợp lệ: `[a-zA-Z0-9-_]{1,64}`
- `*` → 404 đơn giản

## Database (1 bảng duy nhất)

```sql
create table public.notes (
  slug text primary key,
  -- snapshot Y.Doc state (base64) để bootstrap nhanh
  ydoc_state text not null default '',
  -- plain text content cache cho list/preview/search sau này
  content text not null default '',
  char_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Public app: ai có URL đều đọc/ghi (theo yêu cầu user)
alter table public.notes enable row level security;
create policy "anyone read"  on public.notes for select to anon, authenticated using (true);
create policy "anyone write" on public.notes for insert to anon, authenticated with check (true);
create policy "anyone update" on public.notes for update to anon, authenticated using (true);
```

Realtime broadcast không cần publication — dùng `supabase.channel(...).send({ type:'broadcast', event:'y-update', payload })`.

## Tech stack thêm

- `yjs`, `y-indexeddb` — CRDT + local-first persistence
- `@codemirror/*` + `y-codemirror.next` — editor markdown với binding Yjs
- `@codemirror/lang-markdown`, markdown preview dùng `marked` + `DOMPurify`
- Đã có sẵn: Supabase client, tailwind, shadcn

## Files sẽ tạo/sửa

**Xoá** (toàn bộ phần bug tracker + auth):
- `src/pages/Auth.tsx`, `Dashboard.tsx`, `BugCreate.tsx`, `BugDetail.tsx`, `BugList.tsx`, `Analytics.tsx`, `Settings.tsx`, `Landing.tsx`, `Index.tsx`
- `src/contexts/AuthContext.tsx`, `src/components/ProtectedRoute.tsx`, `AppSidebar.tsx`, `AppLayout.tsx`, `SeverityBadge.tsx`, `StatusBadge.tsx`, `Logo3D.tsx`, `NeonPatternDefs.tsx`, `NeonToggle.tsx`, `hooks/use-neon-charts.ts`
- DB cleanup: drop các bảng cũ (`bugs`, `comments`, `attachments`, `activity_log`, `projects`, `invitations`, `notification_preferences`, `company_settings`, `profiles`, `user_roles`) + bucket `bug-attachments`, `avatars`. Giữ nguyên `auth` schema.

**Tạo mới**:
- `src/pages/Home.tsx` — landing tối giản: ô nhập slug, nút "Mở note", danh sách note recent (localStorage)
- `src/pages/NotePage.tsx` — editor full-screen + topbar
- `src/components/note/Editor.tsx` — CodeMirror + Yjs binding + IndexedDB
- `src/components/note/Preview.tsx` — render markdown an toàn (toggle split/preview)
- `src/components/note/Topbar.tsx` — slug, save status, word/char count, presence dots, theme toggle, export, copy URL
- `src/components/note/PresenceDots.tsx` — chấm màu các user đang online (lấy từ Yjs awareness)
- `src/lib/yjs/provider.ts` — `SupabaseYjsProvider` class: kết nối kênh, đẩy/nhận `Y.update`, awareness, snapshot loader/saver
- `src/lib/yjs/identity.ts` — random user color + tên ẩn danh (lưu localStorage)
- `src/lib/recent-notes.ts` — quản lý danh sách note đã mở (localStorage, có rename/remove)
- `src/lib/export.ts` — download `.md` / `.txt`
- `src/App.tsx` — chỉ còn 3 routes: `/`, `/:slug`, `*`
- Cập nhật `index.html` title + meta

## Trạng thái lưu (hiển thị trên topbar)

- `Editing…` — vừa gõ, IndexedDB đã lưu, chưa snapshot lên server
- `Saving…` — đang upsert snapshot
- `Saved` — snapshot xong + realtime đã broadcast
- `Offline` — mất kết nối Supabase channel; vẫn gõ được, sẽ tự sync lại khi online

## Presence

- Mỗi tab tạo random `{ name, color }` lưu localStorage
- Yjs `awareness` truyền qua broadcast channel cùng kênh
- Hiển thị: chấm màu (top-right) + cursor caret màu trong editor (y-codemirror.next built-in)

## UI / Theme

- Dark default + Light toggle (next-themes đã có)
- Font: editor dùng `ui-monospace`, body Inter
- Layout note: full viewport, không sidebar, topbar mỏng 40px
- Mobile: editor full, preview ẩn (toggle bằng nút mắt)

## Trade-offs / lưu ý

- **Public hoàn toàn**: ai biết slug là edit được — đúng yêu cầu, không thêm khoá.
- **Snapshot 1 row/note**: với note rất dài (>1MB) có thể chậm. Đặt giới hạn cảnh báo ở 500KB text.
- **Broadcast không persist**: client mới mở note sẽ load snapshot từ DB rồi join channel để nhận update tiếp theo — đảm bảo không mất chữ.

