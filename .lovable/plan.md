# Plan: giữ debug panel ra khỏi bản published

## Mục tiêu
Đảm bảo `DiagnosticsPanel` (và các panel dev tương lai) **không bao giờ render** trong bản published (DEV=false và không có flag `VITE_DEBUG_*`), để không ai vô tình bật lên gây nhiễu user cuối.

## Hiện trạng
- `UrlSanitizeDebugPanel` đã bị xóa khỏi repo (commit `0e02f514`) vì có thể log fragment capability ra console; không còn panel này để guard.
- `DiagnosticsPanel`: gate bằng `import.meta.env.DEV || VITE_DEBUG_DIAGNOSTICS_PANEL === "1"` → an toàn ở prod.
- Preview Lovable chạy dev server nên vẫn thấy — đây là hành vi mong muốn.

## Việc cần làm
Giữ nguyên file test guard hiện có: `src/components/dev/__tests__/DebugPanels.prod-guard.test.tsx`
mô phỏng môi trường prod (DEV=false, không flag / flag falsy / flag `"1"`),
assert `container.firstChild === null` khi ẩn.

Nếu thêm panel dev mới: đưa panel vào cùng file test guard này trước khi merge.

## Verify
`bunx vitest run src/components/dev/__tests__/DebugPanels.prod-guard.test.tsx` → pass.
Nếu ai đó đổi điều kiện render thành always-on, test fail ngay.
