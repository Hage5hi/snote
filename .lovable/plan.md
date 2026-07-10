## Mục tiêu
Đảm bảo `UrlSanitizeDebugPanel` (góc dưới trái) và `DiagnosticsPanel` (góc dưới phải) **không bao giờ render** trong bản published (DEV=false và không có flag `VITE_DEBUG_*`), để tương lai không ai vô tình bật lên gây nhiễu user cuối.

## Hiện trạng
- `UrlSanitizeDebugPanel`: gate bằng `import.meta.env.DEV || VITE_DEBUG_URL_SANITIZE_PANEL === "1"|"true"` → an toàn ở prod.
- `DiagnosticsPanel`: gate bằng `import.meta.env.DEV || VITE_DEBUG_DIAGNOSTICS_PANEL === "1"` → an toàn ở prod.
- Preview Lovable chạy dev server nên vẫn thấy — đây là hành vi mong muốn.

## Việc cần làm
Thêm 1 file test guard (Vitest + React Testing Library) mô phỏng môi trường prod:

**File mới:** `src/components/dev/__tests__/DebugPanels.prod-guard.test.tsx`

Cho từng panel, test 3 case:
1. `DEV=false`, không có flag → `container` rỗng (không render gì).
2. `DEV=false`, flag = `"0"` / `"false"` → vẫn rỗng.
3. `DEV=false`, flag = `"1"` → có render (chứng minh flag vẫn là escape hatch cho staging debug).

Kỹ thuật:
- Dùng `vi.stubEnv("DEV", false)` và `vi.stubEnv("VITE_DEBUG_URL_SANITIZE_PANEL", ...)` / `VITE_DEBUG_DIAGNOSTICS_PANEL`.
- `afterEach(() => vi.unstubAllEnvs())`.
- Render trong `<MemoryRouter>` nếu component dùng `useLocation` (UrlSanitizeDebugPanel).
- Assert `container.firstChild === null` cho case ẩn.

## Không đụng vào
- Không sửa logic 2 panel — hành vi hiện tại đã đúng.
- Không đổi env/`.env`.
- Không đụng UI khác.

## Verify
`bunx vitest run src/components/dev/__tests__/DebugPanels.prod-guard.test.tsx` → tất cả case pass. Nếu ai đó tương lai đổi điều kiện thành always-on, test sẽ fail ngay.