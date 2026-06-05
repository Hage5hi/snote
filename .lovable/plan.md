## Rà soát trước khi build

Có 8 yêu cầu, một số trùng/đụng với code đã có. Mình đề xuất scope như sau:

### Sẽ làm

1. **E2E hai tab cùng note** (`e2e/preview-multi-tab.spec.ts`)
   - Mở cùng slug ở 2 browser context, toggle preview ở mỗi tab → state không lẫn (key viewport đã tách).
   - F5 + chuyển tab (`visibilitychange`) → doc-cache không destroy doc đang hiển thị ở tab kia.

2. **Unit test: localStorage quota/blocked**
   - Mở rộng `use-preview-visible.test.ts`: mock `setItem` throw `QuotaExceededError` → hook không throw, fallback theo viewport, toggle vẫn chạy in-memory.
   - Đã có nhánh blocked storage; thêm case quota.

3. **Dev metrics export** (`src/lib/yjs/doc-cache.ts`)
   - Export `getDocCacheMetrics()` trả `{ max, idleMs, migrateCount, destroyCount, acquireCount, currentSize }`.
   - Bật qua `localStorage["debug:doc-cache"]="1"` đã có; chỉ thêm counter + getter, không log thêm.
   - Tương tự `getPreviewMigrateMetrics()` trong `use-preview-visible.ts`.

4. **E2E rapid resize dài hơi** (`e2e/preview-rapid-resize.spec.ts`)
   - Loop 50 lần resize desktop↔mobile + 3 lần F5; assert `acquireCount`/`destroyCount` ≤ ngưỡng hợp lý, preview state đúng theo viewport cuối.

5. **Unit test lazy CommandPaletteBody** (`src/components/__tests__/CommandPalette.lazy.test.tsx`)
   - Render `<CommandPalette/>` → body chưa mount (query DOM không thấy dialog).
   - Fire `keydown Ctrl+K` → `await` Suspense resolve → dialog xuất hiện.
   - Dùng `vi.mock('./CommandPaletteBody', ...)` để spy số lần import.

6. **E2E Ctrl/⌘+K sau F5** (`e2e/command-palette-lazy.spec.ts`)
   - Load Home, assert network không có chunk chứa `cmdk` trước khi bấm phím.
   - Bấm Ctrl+K, đo `performance.now()` từ keydown → dialog visible, assert < 800ms (ngưỡng nới rộng cho CI).

7. **Đo thời gian render palette lần đầu vs lần sau**
   - Trong cùng spec ở (6): mở/đóng/mở lại, so sánh `firstOpenMs` vs `secondOpenMs` (lần sau phải nhanh hơn, không cần lazy).

### KHÔNG làm (và lý do)

- **"Focus trap + Tab/Escape cho CommandPalette"**: `CommandDialog` từ shadcn dùng Radix `Dialog`, đã có focus trap, restore focus, và Escape close sẵn. Thêm logic riêng sẽ chồng chéo và dễ vỡ a11y. Nếu bạn thấy bug cụ thể (vd Tab thoát khỏi dialog), cho mình repro thay vì viết trap mới.

### Ghi chú kỹ thuật

- Metrics chỉ phơi ra qua `window.__docCacheMetrics` khi flag debug bật, không ảnh hưởng prod bundle (tree-shake bằng `if (import.meta.env.DEV || flag)`).
- E2E rapid-resize sẽ chạy trong `ALWAYS_RUN` của `scripts/e2e-run-changed-scenes.ts` cùng với spec hai tab.
- Không thêm dependency mới.

OK đi theo scope này, hay bạn muốn mình vẫn viết focus trap thủ công cho CommandPalette?
