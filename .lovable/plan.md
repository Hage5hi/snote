# Topbar redesign — phong cách Replit

## Mục tiêu
Thay thế hàng icon dày đặc bằng 4 dropdown **text-label** gọn gàng, giảm tải thị giác, gom action theo ngữ nghĩa, giữ shortcut nhanh cho các action hay dùng nhất.

## Bố cục mới (trái → phải)

```text
[Brand: slug + status]  ...  [0 words 0 chars] [●] [★] [🔒] [⤴ share] [👁 preview] [🔗 copy URL] | [Note ▾] [Mode ▾] [Export ▾] [Help ▾] | [🌓]
```

**Icon rời (giữ):** word/char trigger, status dot, Pin (star), Lock, Share, Preview toggle (eye), Copy note URL (link icon — shortcut nhanh, duplicate có chủ ý với Export → Copy note URL).

**Bỏ icon rời:** Copy entire note (chuyển vào Note menu), Rename (vào Note), Shortcuts keyboard (vào Help), Settings gear (giải thể thành Mode + Note + Help).

## Nội dung 4 dropdown

### Note ▾
- Rename slug… (mở RenameDialog)
- Duplicate note… (mở DuplicateDialog)
- Set word goal… (mở WordGoalDialog)
- ─
- History & Restore (mở HistoryDialog)
- Copy entire note  `⌘⇧C`
- ─
- Clear all snapshots… (destructive, đỏ)

### Mode ▾
- Enter/Exit Zen mode  `F11`
- Enter/Exit Typewriter mode  `F9`
- Enable/Disable Focus line
- Enable/Disable Page mode  `⌘⇧P`
- Enable/Disable Vim mode
- ─ `E-ink mode` (label)
- ○ Auto-detect / On / Off (radio group)

### Export ▾
- Copy note URL (window.location)
- ─
- Download .md
- Download .html
- Print to PDF
- Download .txt
- ─
- Copy as AI context
- Copy raw URL (cURL) — disabled khi encrypted

### Help ▾
- Keyboard shortcuts & tips  `?` (mở ShortcutHelp)
- ─ `Split view` (label nhỏ)
- Mở URL `/a+b` để xem 2 note cạnh nhau (item info, không click)

## Files thay đổi

**Tạo mới:**
- `src/components/note/topbar/NoteMenu.tsx` — dropdown Note
- `src/components/note/topbar/ModeMenu.tsx` — dropdown Mode (gộp toggle + e-ink radio + vim)
- `src/components/note/topbar/HelpMenu.tsx` — dropdown Help
- `src/components/note/topbar/CopyUrlButton.tsx` — icon copy current page URL

**Sửa:**
- `src/components/note/topbar/ExportMenu.tsx` — thêm "Copy note URL" item ở đầu, đổi trigger từ icon → text "Export ▾"
- `src/components/note/topbar/Topbar.tsx` — bố cục mới, thêm state `clearSnapshotsOpen`, gọn imports, bỏ Shortcuts icon rời, bỏ Rename icon rời, bỏ Copy-all icon rời, bỏ SettingsMenu, thay bằng 4 menu mới. Giữ nguyên keyboard shortcuts `⌘⇧C` và `⌘⇧V`.

**Xoá:**
- `src/components/note/topbar/SettingsMenu.tsx` (nội dung phân bổ vào Mode + Note + Help)

## Chi tiết kỹ thuật

- **Dropdown trigger text**: `<Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-sm font-normal">Note <ChevronDown className="h-3 w-3 opacity-60" /></Button>`. Không dùng icon-only.
- **Compact mode** (SplitView): tiếp tục ẩn Mode/Help/ThemeToggle như cũ; Note + Export vẫn hiện vì là per-note actions. ExportMenu prop signature giữ nguyên.
- **Clear all snapshots**: tái dùng logic hiện có trong HistoryDialog (đã có nút). Trong Note menu, item này dispatch event mở HistoryDialog ở tab snapshots — hoặc đơn giản hơn: chỉ giữ "History & Restore" (mở dialog), bỏ "Clear all snapshots" khỏi menu để tránh dup logic. **Quyết định: bỏ "Clear all snapshots" khỏi menu** — user vào History dialog là thấy nút clear. Giữ menu Note đúng 6 item như Replit screenshot, không thêm destructive item phải confirm.
- **Copy note URL** (icon rời + Export item): copy `window.location.href`, toast confirm.
- **Responsive**: viewport hiện tại 867px đủ chỗ. Trên `<640px` (sm:), ẩn các dropdown text → fallback về SettingsMenu cũ? **Không** — giữ đơn giản, các dropdown text + icon rời vẫn fit. Word/char pill đã ẩn ở mobile (existing). Nếu thiếu chỗ, có thể ẩn label "words/chars" và shorten "Note/Mode/Export/Help".
- **Bundle**: không add deps. Tách 3 file menu nhỏ + xoá 1 file = net ~+50 LOC, gz delta <1KB.
- **Tests**: existing 58 tests không touch logic → vẫn pass. TopbarBrand giữ nguyên.

## Self-test
1. `tsc --noEmit` clean
2. `vitest run` → 58/58 pass
3. `bun run lint` clean
4. `bun run build:check` exit 0
5. Smoke: mở /<slug>, click từng menu, verify item đúng → click action → dialog/toast chạy đúng
6. Compact mode (SplitView `/a+b`): Mode/Help/ThemeToggle ẩn, Note/Export hiện

## Không làm
- Không đổi TopbarBrand
- Không đổi logic hooks (use-zen/use-typewriter/use-eink/use-vim…)
- Không thêm deps
- Không đổi RenameDialog/DuplicateDialog/HistoryDialog/WordGoalDialog/ShareDialog
- Không thêm route mới (Split view đã có `/a+b` pattern)
