
## Refactor Topbar thành nhiều file nhỏ

`Topbar.tsx` đã >370 dòng, ôm quá nhiều trách nhiệm: status, presence, word count + goal, preview toggle, zen, pagination, settings dropdown, export dropdown, share dialog, history dialog, rename dialog, duplicate dialog, word goal dialog, lock button. Tách ra để dễ đọc và sửa.

### Cấu trúc mới

```text
src/components/note/topbar/
├── Topbar.tsx              # Container chính, compose các phần
├── TopbarBrand.tsx         # Logo + slug + tags
├── WordCountTrigger.tsx    # Số chars/words + progress bar goal (click → mở WordGoalDialog)
├── ViewControls.tsx        # Preview toggle, Zen, Pagination toggle
├── ExportMenu.tsx          # Dropdown Export (MD/HTML/PDF/TXT)
└── SettingsMenu.tsx        # Dropdown Settings (Rename, Duplicate, History, Share, Lock...)
```

`src/components/note/Topbar.tsx` giữ lại như một re-export mỏng (`export { Topbar } from "./topbar/Topbar"`) để các import hiện tại (NotePage, SplitView nếu có) không phải đổi.

### Phân chia trách nhiệm

- **Topbar.tsx (container, ~80 dòng)**: nhận props từ NotePage, sở hữu state cho các dialog (rename/duplicate/history/share/wordGoal), render layout 3 cột (brand | center | actions).
- **TopbarBrand.tsx**: slug, status pill, presence dots, tag chips.
- **WordCountTrigger.tsx**: hiển thị `{words} từ · {chars} ký tự`, nếu có goal thì thêm progress bar mỏng + `%`. Click mở WordGoalDialog. Nhận `slug`, `words`, `chars`, `onOpenGoal`.
- **ViewControls.tsx**: 3 toggle button (Preview, Zen, Pagination) + tooltips.
- **ExportMenu.tsx**: gói toàn bộ dropdown export hiện tại, nhận `getContent` + `slug`.
- **SettingsMenu.tsx**: gói dropdown Settings hiện tại (Rename, Duplicate, History, Share, Lock/Unlock...), nhận callbacks để mở dialog tương ứng.

### Nguyên tắc

- Không thay đổi behavior, chỉ di chuyển code.
- Giữ nguyên props của `Topbar` để `NotePage.tsx` không cần đổi.
- Mỗi file mới <120 dòng, có 1-2 dòng comment đầu file mô tả vai trò.
- Dialog state (open/close cho rename, duplicate, share, history, wordGoal) ở lại container Topbar để SettingsMenu chỉ là presentational.

### Files thay đổi

- ✏️ `src/components/note/Topbar.tsx` → rút gọn thành re-export.
- ➕ `src/components/note/topbar/Topbar.tsx`
- ➕ `src/components/note/topbar/TopbarBrand.tsx`
- ➕ `src/components/note/topbar/WordCountTrigger.tsx`
- ➕ `src/components/note/topbar/ViewControls.tsx`
- ➕ `src/components/note/topbar/ExportMenu.tsx`
- ➕ `src/components/note/topbar/SettingsMenu.tsx`

Không đụng database, không đụng logic Yjs, không đổi UI.
