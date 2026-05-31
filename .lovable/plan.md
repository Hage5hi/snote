# Plan

## 1. Ẩn SceneToggle triệt để trên mobile (CSS-based)

Hiện tại `Home.tsx` và `Topbar.tsx` dùng `{!isMobile && <SceneToggle />}`. Vấn đề: `useIsMobile` khởi tạo `undefined` → render lần đầu coi như desktop → SceneToggle nhấp nháy hiện ra trước khi `useEffect` chạy. Trên mạng chậm hoặc khi user tap nhanh có thể mở được dropdown.

**Cách fix:**
- Bọc `<SceneToggle />` trong wrapper `<div className="hidden md:inline-flex">` (Tailwind breakpoint `md` = 768px, khớp với `MOBILE_BREAKPOINT`).
- CSS chạy ngay từ render đầu, không phụ thuộc JS hydration → không còn flash.
- Vẫn giữ guard JS `!isMobile` như layer phụ để đảm bảo không mount component cũng như effect `useEffect` clear scene về `none` trên mobile.

Áp dụng ở:
- `src/pages/Home.tsx` (dòng ~242)
- `src/components/note/topbar/Topbar.tsx` (cả nhánh `narrow` và nhánh wide)

## 2. Đồng bộ icon preview Eye/EyeOff trên mọi viewport

File: `src/components/note/topbar/ViewControls.tsx`

- Bỏ logic chọn `Pencil`/`FileText` cho narrow; luôn dùng `Eye` khi preview đang tắt, `EyeOff` khi đang bật — giống desktop (theo screenshot user cung cấp là icon chuẩn).
- Tooltip + aria-label vẫn giữ wording khác nhau theo narrow/wide vì hành vi thực tế khác (mobile = đổi pane, desktop = ẩn/hiện panel) — giúp user hiểu đúng ngữ cảnh.
- Kích thước icon mobile (h-5 w-5) và touch target (h-9 w-9) giữ nguyên.

## 3. Giữ nguyên logic preview default

Theo xác nhận: `use-preview-visible.ts` đã đúng (default ON cho ≥900px, OFF cho <900px lần đầu, sau đó nhớ localStorage). Không sửa.

## Verification

- `bunx tsc --noEmit` pass.
- Mở preview ở viewport mobile (375px): không thấy SceneToggle ngay từ frame đầu.
- Mở note ở mobile và desktop: icon preview đều là Eye/EyeOff, tooltip wording riêng.
- F5 nhiều lần trên mobile: SceneToggle không flash.

## Lưu ý

Screenshot user gửi từ `note.syrin.online` (bản đã publish) — sau khi merge cần publish lại để domain custom thấy fix.
