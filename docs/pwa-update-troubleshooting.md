# PWA Update Troubleshooting

Guide for end users and support when the "New version available" toast appears
but the app does not update after clicking **Update**.

## Normal flow

1. Toast "New version available" hiện lên.
2. Bấm **Update** → app tự reload → toast biến mất → phiên bản mới đang chạy.
3. URL của note KHÔNG bị thêm `?v=...`. Nếu thấy `?v=`, đó là bug — báo lại kèm URL.

## Nếu Update fail (toast quay lại liên tục)

Nguyên nhân thường gặp:

- Service worker cũ đang giữ HTML cache-first.
- Trình duyệt giữ session cache cho tab.
- Extension chặn `/version.json` hoặc `/sw.js`.

### Cách xử lý an toàn (thứ tự từ nhẹ → nặng)

1. **Hard reload**: `Ctrl/Cmd + Shift + R`. Thường đủ.
2. **Đóng hẳn tab & mở lại** từ URL gốc (không dùng back/forward).
3. **Xóa site data cho domain này** (khuyến cáo cuối cùng — sẽ xóa sạch dữ liệu
   local của web trên máy bạn: draft chưa sync, cài đặt UI, cache offline):
   - Chrome/Edge: `chrome://settings/content/all` → tìm domain → **Delete**.
   - Firefox: `about:preferences#privacy` → **Manage Data** → chọn domain → **Remove**.
   - Safari: Preferences → Privacy → **Manage Website Data** → chọn domain → **Remove**.
   - DevTools nhanh: mở DevTools → **Application** → **Storage** → **Clear site data**.
4. Reload lại — service worker sẽ được thay thế bằng bản mới.

### Điều KHÔNG nên làm

- Không cần xóa toàn bộ cookie trình duyệt — chỉ xóa cho domain này.
- Không cần gỡ cài đặt app (nếu đã Add to Home Screen) — clear site data là đủ.
- Không thêm `?v=xxx` vào URL để "ép" update — đã bị loại bỏ khỏi flow.

## Cho developer

- Toast state: `window.__SNOTE_PWA_UPDATE_STATE__` (chỉ DEV).
- Debug panel (DEV): góc phải dưới, hiển thị current/pending/strategy/attempts.
- Cleanup thủ công: `await window.__SNOTE_PWA_UPDATE_CLEANUP__?.()` để gỡ listener/timer.
- Kill-switch qua URL: `?sw=off` để unregister app SW mà không đụng Firebase Messaging / OneSignal cache.
- Cleanup scope test: `src/lib/__tests__/pwa-update-nuke-scope.test.ts` bảo đảm chỉ xóa cache của app (`precache-v*`, `runtime-*`, `workbox-*`, `/sw.js`, `/service-worker.js`), không đụng cache khác.

## Regression coverage

| Symptom | Test |
|---|---|
| Toast không biến mất sau khi build mới ship | `src/lib/__tests__/pwa-update.test.ts`, `e2e/pwa-update-throttle.spec.ts` |
| Multi-click Update thêm `?v=` vào URL note | `e2e/pwa-update-multi-click.spec.ts`, `e2e/pwa-update-no-url-v-param.spec.ts` |
| Remount panel làm tăng invalid-events / duplicate listener | `src/lib/__tests__/pwa-update-listener-dedup.test.ts` |
| Cleanup xóa nhầm cache của integration khác | `src/lib/__tests__/pwa-update-nuke-scope.test.ts` |
