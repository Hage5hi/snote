

## Ẩn admin sau hash + giả 404 + bảo mật cao

### Hành vi mới

| URL | Hành vi |
|---|---|
| `/note` (không hash) | Render `NotFound` y hệt 404 thật. Không hint gì về admin. |
| `/note#<sai>` | Cũng render `NotFound`. Edge function trả 401 → fallback NotFound, không show error riêng. |
| `/note#<đúng>` | Verify pass với edge function → lưu sessionStorage → **xoá hash khỏi URL** (`history.replaceState('', '', '/note')`) → render Admin panel. |
| `/note` với session đã verify trong tab | Vào thẳng Admin (không cần hash lại). |
| Tab mới / hard reload không hash | Lại 404 (sessionStorage scope theo tab). |

### Tăng cường bảo mật

1. **Giả 404 hoàn hảo**: dùng đúng component `NotFound` hiện tại, cùng status code message, cùng layout. Không có timing difference (verify pass luôn chạy cùng độ trễ, kể cả khi hash rỗng — gọi edge function với pass rỗng vẫn để constant-time so sánh). Người dò không phân biệt được `/note` với route random `/abcxyz`.

2. **Xoá hash sau khi verify**: ngay khi pass đúng, `history.replaceState(null, "", "/note")` để:
   - Không lưu trong browser history bar.
   - Screenshot/screen-share sau đó không lộ pass.
   - Refresh trong tab vẫn vào (nhờ sessionStorage), tab mới phải nhập lại hash.

3. **Robots noindex**: thêm `Disallow: /note` vào `public/robots.txt` + thêm thẻ `<meta name="robots" content="noindex,nofollow">` được inject động khi route là `/note` (qua `useEffect` set document head). Search engine không index được.

4. **Bundle riêng + tên obfuscate**: AdminPanel đã `lazy()` rồi nhưng chunk có tên `AdminPanel-xxx.js`. Trong `vite.config.ts` `manualChunks`, đặt tên chunk thành `chunk-a8f3.js` (neutral). Người xem network tab không đoán ra.

5. **Constant-time verify ở client side**: gọi `admin-list` ngay khi mount với hash (kể cả rỗng) để response timing đồng đều. Edge function đã constant-time so sánh — giữ nguyên.

6. **Không log hash anywhere**: bỏ bất kỳ `console.log` nào động đến hash.

7. **SessionStorage giữ nguyên** (theo lựa chọn user) nhưng:
   - Key đổi từ `admin.passphrase` thành `__a` (neutral) để tránh dò qua DevTools storage panel.
   - Giá trị vẫn là passphrase thô (cần để gọi edge functions sau).

### Files thay đổi

- ✏️ `src/pages/AdminPanel.tsx`:
  - Mount → đọc hash → nếu có, gọi `admin-list` để verify → đúng thì `replaceState` xoá hash + lưu sessionStorage + render panel.
  - Nếu sai/không có hash + không có session → render `<NotFound />`.
  - Bỏ login form (không còn cần — vào bằng hash).
  - Đổi SESSION_KEY thành `"__a"`.
  - Thêm `useEffect` set `<meta name="robots" content="noindex">` khi component mount.

- ✏️ `src/App.tsx`: `SlugDispatcher` cho `slug === "note"` giữ nguyên (vẫn route đến AdminPanel chunk), nhưng AdminPanel tự quyết định show 404 hay panel.

- ✏️ `public/robots.txt`: thêm `Disallow: /note`.

- ✏️ `vite.config.ts`: trong `manualChunks`, gom AdminPanel vào chunk tên neutral (vd `chunk-admin` → đổi thành `chunk-a8f3` hoặc để Vite hash mặc định nhưng bỏ comment).

### Flow chi tiết AdminPanel mới

```
mount
  ├── đọc hash → hashKey
  ├── đọc sessionStorage __a → cachedKey
  ├── key = hashKey || cachedKey
  ├── nếu key rỗng → render <NotFound />
  ├── verify(key) qua edge function admin-list (limit:1)
  │     ├── 401 → render <NotFound />
  │     └── 200 →
  │           ├── sessionStorage.setItem("__a", key)
  │           ├── history.replaceState(null, "", "/note")
  │           ├── render Admin UI
```

Trong lúc verify (vài trăm ms): render `<NotFound />` luôn để không nháy. Nếu verify đúng mới swap sang Admin (transition mượt).

### Lưu ý không ảnh hưởng tốc độ

- AdminPanel vẫn lazy-load → user thường không tải chunk này.
- Verify call chỉ chạy khi có hash hoặc session → không thêm round-trip cho user thường.
- NotFound render ngay (không Suspense fallback nhấp nháy).
- Không đổi gì ở NotePage / Editor → zero impact UX chính.

### Không làm

- Không 2FA (user không chọn).
- Không rate-limit DB-side (theo `important-info`).
- Không đổi passphrase hiện tại — vẫn dùng `ADMIN_PASSPHRASE` secret cũ.
- Không đụng `admin-list` / `admin-delete` / `cleanup` edge functions.

