
## 1. Default theme = Light

**File:** `src/App.tsx` (line 75)

Đổi `<ThemeProvider attribute="class" defaultTheme="dark" enableSystem>` → `defaultTheme="light"`.

⚠️ Lưu ý: `next-themes` lưu lựa chọn người dùng vào `localStorage`. Người đã chủ động chọn dark trước đó vẫn giữ dark. Chỉ visitor mới (chưa có key `theme` trong localStorage) sẽ thấy light. Đây là hành vi mong muốn.

**Verify:** Mở incognito → preview phải load light theme. Toggle dark/light vẫn hoạt động bình thường.

---

## 2. Khôi phục Topbar đầy đủ trong SplitView (`/a+b`)

**Vấn đề hiện tại:** `src/pages/NotePage.tsx` line 298-304 — khi `embedSlug` được set (SplitView truyền vào), NotePage chỉ render `<Editor>` trần, **bỏ toàn bộ Topbar** (preview toggle, zen, typewriter, lock, share, status, presence, word count…). SplitView chỉ có 1 header tối giản chung cho cả 2 panel ở `src/pages/SplitView.tsx` line 56-86.

**Cách xử lý — đề xuất A (mặc định, ít rủi ro):**
- Trong NotePage embed mode, render thêm 1 phiên bản **Topbar gọn cho từng panel**: chỉ giữ các nút có ý nghĩa per-panel (preview toggle, lock, share, rename, status pill, word count pill, presence dots). Bỏ những thứ global (zen, typewriter, focus-line, pagination — vì áp dụng cho cả app, không per-panel).
- SplitView header chung vẫn giữ nguyên (Home + Sync scroll + slug labels).

**Cách xử lý — đề xuất B (đơn giản hơn):**
- Render full `<Topbar>` trong embed mode luôn. Hai topbar nằm song song trên mỗi panel. Trade-off: chiếm thêm 44px chiều cao mỗi panel; một số toggle global (zen, pagination) sẽ trùng nhau giữa 2 panel.

→ **Tôi recommend A** — clean hơn, không trùng lặp. Cần tách thành prop `compact` cho `<Topbar>` để bỏ các nút global khi embed.

**Files:**
- `src/components/note/topbar/Topbar.tsx` — thêm prop `compact?: boolean`, ẩn ZenButton/TypewriterButton/PaginationToggle/FocusLine khi compact.
- `src/pages/NotePage.tsx` line 298-304 — render `<Topbar ... compact />` trong embed mode.

**Verify:** Mở `/note-a+note-b` → mỗi panel có topbar riêng với preview/lock/share/rename. SplitView header trên cùng vẫn có Sync scroll button.

---

## 3. Mobile preview = vertical split (trên/dưới) thay vì chiếm trọn màn hình

**Vấn đề hiện tại:** `src/pages/NotePage.tsx` line 333-350. Layout hiện tại:
```
<main className="flex divide-x">  // luôn flex-row
  <div className={showPreview ? "hidden md:block md:flex-1" : "flex-1"}>
    Editor
  </div>
  {showPreview && <div className="flex-1">Preview</div>}
</main>
```

Trên mobile (<768px), khi bật preview: editor bị `hidden`, preview chiếm 100%. → Người dùng không vừa gõ vừa xem được.

**Đề xuất:** Dùng `flex-col md:flex-row` để mobile chia trên/dưới, desktop vẫn trái/phải. Mỗi panel `flex-1` → chia 50/50.

```
<main className="flex flex-col md:flex-row flex-1 min-h-0 divide-y md:divide-y-0 md:divide-x divide-border">
  <div className={showPreview ? "flex-1 min-h-0 min-w-0" : "flex-1 min-w-0"}>
    <Editor ... />
  </div>
  {showPreview && (
    <div className="flex-1 min-h-0 min-w-0 overflow-auto bg-muted/30">
      <Preview ... />
    </div>
  )}
</main>
```

Bonus: trên mobile, nên cân nhắc thêm cử chỉ vuốt giữa 2 panel hoặc nút "swap order" (preview lên trên/xuống dưới), nhưng đó là scope riêng — không làm trừ khi bạn xác nhận muốn.

**Verify:** Resize viewport <768px → bật preview → thấy editor nửa trên, preview nửa dưới, có divider ngang ở giữa. Desktop vẫn trái/phải.

---

## 4. Đổi màu text selection trong dark mode sang vàng dễ đọc

**Vấn đề hiện tại:** `src/index.css` line 164-180 — selection dùng `hsl(var(--primary) / 0.35)` = indigo nhạt 35% trên nền `240 6% 6%` (gần đen). Foreground giữ nguyên `--foreground` = `0 0% 90%` (xám sáng) → contrast yếu, chữ bị "chìm" khi bôi đen.

**Đề xuất:** Tách 2 token mới `--selection-bg` và `--selection-fg`, set giá trị riêng cho light vs dark:
- **Light:** giữ tint primary nhẹ như cũ (đã đủ đọc).
- **Dark:** dùng vàng warm có brightness vừa phải — `hsl(45 100% 55% / 0.45)` (vàng amber, alpha 45%) + foreground `hsl(0 0% 100%)` (trắng). Vàng/amber + chữ trắng đảm bảo contrast WCAG AA cả với chữ đen lẫn các màu syntax highlight của CodeMirror.

**Files:**
- `src/index.css`:
  - `:root` thêm: `--selection-bg: 234 55% 58%; --selection-fg: 0 0% 9%;` (light: tint primary, chữ đen).
  - `.dark` thêm: `--selection-bg: 45 100% 55%; --selection-fg: 0 0% 5%;` (dark: vàng amber + chữ gần đen — vàng nền sáng, chữ đen đọc tốt nhất).
  - Sửa các selector selection (line 164-180): `background-color: hsl(var(--selection-bg) / 0.45); color: hsl(var(--selection-fg));`
  - Cập nhật `.cm-editor .cm-selectionBackground` tương ứng.

Lưu ý: trên nền vàng, chữ đen đọc rõ hơn chữ trắng. Tôi propose `--selection-fg` trong dark mode = đen (`0 0% 5%`) chứ không phải trắng — dù theme tối, riêng phần được bôi đen sẽ "đảo màu" chữ thành đen trên nền vàng. Nếu bạn không thích đảo và muốn giữ chữ trắng/sáng, nói tôi đổi lại — khi đó alpha phải hạ xuống ~25% để chữ trắng vẫn đọc được trên vàng nhạt.

**Verify:** Dark mode → bôi đen 1 đoạn → nền vàng amber, chữ đen, đọc rõ, không che chữ. Light mode → giữ tint xanh-tím như cũ.

---

## 5. Đề xuất bổ sung / nâng cấp (chờ bạn quyết)

Những gì tôi nhận thấy khi đọc code, **không tự làm** trừ khi bạn đồng ý từng cái:

### a) Mobile preview UX
- **Nút "swap": preview lên trên/xuống dưới** — hữu ích khi gõ trên mobile vì keyboard chiếm nửa dưới, người dùng có thể muốn editor ở dưới (sát keyboard) hoặc trên (xa keyboard).
- **Resize handle giữa 2 panel** (kéo để chia tỷ lệ 30/70, 70/30…) — desktop và mobile đều hữu ích.

### b) Theme system
- Hiện `enableSystem` đang bật → `next-themes` sẽ tôn trọng `prefers-color-scheme` của OS nếu user chưa chọn. Nếu bạn muốn **force light mặc định bất kể OS**, cần `enableSystem={false}`. Hỏi rõ: bạn muốn (i) light là default nhưng OS dark → vẫn dark, hay (ii) **luôn luôn light cho user mới** kể cả OS đang dark?

### c) Selection màu — alternatives
Ngoài vàng amber, một option khác là **xanh teal** (`hsl(180 70% 50%)`) — vẫn nổi bật trên nền tối nhưng "lạnh" hơn, hợp với indigo primary hiện tại của app. Bạn muốn vàng (như đề xuất) hay teal?

### d) Bảo mật / migrations còn tồn đọng
Theo lịch sử conversation: migration drop leftover buckets (avatars + bug-attachments) **vẫn chưa apply**. Có muốn tôi gộp luôn vào lần này không, hay để riêng PR khác?

### e) Cleanup nhỏ
- File `vite.config.ts` mới thêm plugin `prefetchEditorChunks` — TypeScript build-side ổn nhưng `tags` array nên được khai báo type rõ ràng để `transformIndexHtml` không return `undefined` ngầm khi `targets` rỗng. Trivial.
- `src/pages/SplitView.tsx` line 1: import `lazy, Suspense` nhưng không dùng `lazy` trực tiếp — đang dùng. OK, bỏ qua.

### f) Câu hỏi rõ trước khi action
1. **Topbar trong SplitView**: chọn approach **A** (compact per-panel topbar) hay **B** (full topbar mỗi panel)?
2. **Selection màu trong dark**: **vàng amber + chữ đen** (đề xuất, contrast cao nhất) hay **vàng + chữ trắng nhạt** (giữ feel dark theme) hay **teal**?
3. **Theme**: light là default nhưng tôn trọng OS dark, hay **luôn light** cho user mới?
4. **Gộp drop-buckets migration** vào PR này luôn không?

Khi bạn trả lời 4 câu trên, tôi switch sang default mode và execute. Các thay đổi (1)(3)(4) trong plan này không đụng database, chỉ đụng `src/App.tsx`, `src/index.css`, `src/pages/NotePage.tsx`, `src/components/note/topbar/Topbar.tsx`, `src/pages/SplitView.tsx`. Migration chỉ thêm nếu bạn duyệt câu (f.4).
