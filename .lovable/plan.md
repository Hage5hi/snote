

# Plan: Sweep cuối — phát hiện gap & polish nhỏ

## Tóm tắt
Đọc kỹ toàn bộ code Phase 3-6, tôi thấy **các tính năng chính đã đầy đủ**. Còn lại chỉ là vài bug nhỏ và polish. Đề xuất 3 nhóm việc:

## A. Bug fixes (3 cái nhỏ)

### A1. `TagChips` đang dùng `<a href>` → reload full page
File `src/components/note/TagChips.tsx` dùng `<a href="/note#tag=...">` — click sẽ reload toàn bộ app. Nên dùng `Link` từ `react-router-dom` để giữ SPA navigation và pop history đúng cách.

### A2. Warning `forwardRef` vẫn còn ở `Home`
Console log mới nhất:
```
Function components cannot be given refs.
at Home (...)
```
React Router v6 truyền ref vào element của Route khi unmount để focus. Fix gọn: bọc `<Home />` trong route element bằng arrow inline (đã có) — nguyên nhân thực ra là `<Sonner />` / `<Toaster />` sau khi đã chuyển vẫn còn TooltipProvider con khác (hoặc thực ra là `Home` không forward ref). Cần thử `forwardRef` cho `Home` để tắt warning, hoặc verify lại stack trace bằng browser test.

### A3. `exportPdf` có thể trigger print với iframe trống
`iframe.onload` được gắn TRƯỚC khi `iframe.srcdoc` set → onload đầu tiên khi append với `about:blank` có thể chạy với document trống. Đảo thứ tự: `srcdoc` trước, sau đó append vào DOM, hoặc check `iframe.contentDocument.body.children.length > 0`.

## B. Verify thực tế bằng browser

Sau khi fix A1-A3, dùng browser tool để chạy 1 lượt smoke test nhanh:
1. `/` → custom slug check (gõ `verify-final` → "Available")
2. Mở `/verify-final`, gõ markdown có `# H1`, `## H2`, `#tag1 #tag2`
3. Xác nhận: Outline button mở, click heading nhảy đúng; TagChips hiện ở Topbar (sau A1: click không reload); Cmd+F search panel mở; Share dialog QR hiện
4. `/note` → kiểm tra tag filter chip hoạt động

## C. Tính năng còn thiếu (optional, để bạn chọn)

Nếu muốn tiếp tục build, đây là list tôi thấy còn missing:

| Tính năng | Lý do |
|---|---|
| **Highlight `#tag` trong editor** | Tag hiện như text thường — nên có color/bold để dễ scan note dài |
| **Pin recent notes** trong Cmd+K | Note quan trọng dễ bị trôi xuống dưới |
| **Empty state cho `/`** khi chưa có recent | UI hơi trống khi dùng lần đầu |
| **Keyboard shortcut help dialog** (`?`) | App đã có nhiều shortcut — cần cheatsheet |
| **Auto-link URL trong preview** | Marked GFM đã handle, nhưng chưa verify |

## Đề xuất

Tôi sẽ làm **A (3 fix nhỏ) + B (smoke test)** trong 1 lượt. C để bạn quyết tiếp.

