# Extension v1.1.0 — Settings, phím tắt, và phát hiện iframe context

## Tóm tắt

Nâng cấp `chrome-extension/` từ v1.0.0 → v1.1.0 với 4 việc:
1. Trang Settings (`options.html`) cho phép user chọn cách side panel mở
2. Phím tắt `Alt+S` mở/đóng side panel (qua `chrome.commands` + `background.js`)
3. Web app phát hiện `?from=ext` để ẩn `InstallPrompt`
4. Bump version, rebuild ZIP

Đã loại bỏ khỏi scope (theo đánh giá của bạn — đều đúng):
- ❌ Chỉnh độ rộng side panel (Chrome không có API)
- ❌ Re-implement lock/unlock (web app đã có sẵn `UnlockForm`)
- ❌ Offline fallback riêng (PWA của web app đã lo)

---

## 1. Settings page (`chrome-extension/options.html` + `options.js` + `options.css`)

**UI** (dark theme `#0A0A0B`, khớp với sidepanel.css):

```text
┌─────────────────────────────────────────┐
│  Syrin Note — Side Panel Settings       │
├─────────────────────────────────────────┤
│  When I open the side panel, go to:     │
│                                          │
│  ( ) The homepage (random new note)     │
│  (•) A specific note                    │
│        Slug: [ my-default-note      ]   │
│  ( ) The last note I had open           │
│                                          │
│  [ Save ]   ✓ Saved                     │
└─────────────────────────────────────────┘
```

**Storage** (`chrome.storage.sync`, sync giữa các máy):
```js
{
  openMode: "home" | "slug" | "last",
  defaultSlug: "string|empty",
  lastSlug: "string|empty"  // mode "last" — chỉ ghi qua postMessage (xem dưới)
}
```

**Validation slug**: dùng cùng regex của web app: `/^[a-zA-Z0-9_-]{1,64}$/`. Slug invalid → disable Save + báo lỗi inline.

**Đăng ký trong `manifest.json`**:
```json
"options_ui": { "page": "options.html", "open_in_tab": false }
```

## 2. `sidepanel.js` đọc settings khi mở panel

Thay vì hard-code `src="https://note.syrin.online/?from=ext"`, dynamic build:

```js
chrome.storage.sync.get(
  { openMode: "home", defaultSlug: "", lastSlug: "" },
  ({ openMode, defaultSlug, lastSlug }) => {
    let path = "/";
    if (openMode === "slug" && defaultSlug) path = `/${defaultSlug}`;
    else if (openMode === "last" && lastSlug) path = `/${lastSlug}`;
    iframe.src = `https://note.syrin.online${path}?from=ext`;
  },
);
```

**Resume last-opened (mode "last")**: cần web app gửi `postMessage` mỗi khi slug đổi. Thêm 1 đoạn nhỏ trong `src/pages/NotePage.tsx` (chỉ chạy khi `from=ext`):

```ts
useEffect(() => {
  if (!isExtensionContext) return;
  try {
    window.parent.postMessage({ type: "syrin:slug", slug }, "*");
  } catch {}
}, [slug, isExtensionContext]);
```

Và `sidepanel.js` lắng nghe:
```js
window.addEventListener("message", (e) => {
  if (e.origin !== "https://note.syrin.online") return;
  if (e.data?.type === "syrin:slug" && typeof e.data.slug === "string") {
    chrome.storage.sync.set({ lastSlug: e.data.slug });
  }
});
```

## 3. Phím tắt Alt+S (`chrome.commands` + `background.js`)

**`manifest.json`** thêm:
```json
"commands": {
  "open-side-panel": {
    "suggested_key": { "default": "Alt+S", "mac": "Alt+S" },
    "description": "Open Syrin Note side panel"
  }
}
```

**`background.js`** thêm listener:
```js
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "open-side-panel") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId != null) {
    await chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
  }
});
```

User có thể tự đổi phím tại `chrome://extensions/shortcuts` nếu Alt+S xung đột.

`Ctrl+K` mở Command Palette **bên trong iframe** đã work sẵn (xem `src/components/CommandPalette.tsx`) — không cần thêm gì.

## 4. Web app: phát hiện `?from=ext`

**`src/lib/ext-context.ts`** (file mới, tiny):
```ts
export const isExtensionContext = (() => {
  if (typeof window === "undefined") return false;
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get("from") === "ext") {
      sessionStorage.setItem("syrin:from-ext", "1");
      return true;
    }
    return sessionStorage.getItem("syrin:from-ext") === "1";
  } catch { return false; }
})();
```
(Lưu vào sessionStorage để các route sau khi navigate không mất context khi query param biến mất.)

**`src/pages/Home.tsx`**: wrap `<InstallPrompt />` bằng `{!isExtensionContext && <InstallPrompt />}` — vì user đang trong extension rồi, prompt cài PWA là thừa.

**`src/pages/NotePage.tsx`**: thêm useEffect postMessage slug (như đã ghi ở mục 2).

## 5. Bump version + rebuild

- `chrome-extension/manifest.json`: `"version": "1.1.0"`
- `chrome-extension/README.md`: ghi chú v1.1.0 changelog + hướng dẫn re-load unpacked
- Rebuild `public/syrin-note-sidepanel.zip`:
  ```bash
  rm -f public/syrin-note-sidepanel.zip
  cd chrome-extension && nix run nixpkgs#zip -- -r ../public/syrin-note-sidepanel.zip .
  ```

---

## Danh sách file đụng đến

**Tạo mới:**
- `chrome-extension/options.html`
- `chrome-extension/options.css`
- `chrome-extension/options.js`
- `src/lib/ext-context.ts`

**Sửa:**
- `chrome-extension/manifest.json` (version, commands, options_ui)
- `chrome-extension/background.js` (commands listener)
- `chrome-extension/sidepanel.js` (read storage, build src, listen postMessage)
- `chrome-extension/sidepanel.html` (bỏ hard-code src, để JS set)
- `chrome-extension/README.md` (changelog + Alt+S note)
- `src/pages/Home.tsx` (gate InstallPrompt)
- `src/pages/NotePage.tsx` (postMessage slug khi from=ext)
- `public/syrin-note-sidepanel.zip` (rebuild)

## Những thứ KHÔNG làm (xác nhận lại)

- Không sửa `_headers` CSP (đã đúng từ v1.0.0)
- Không sửa `Privacy.tsx` (vẫn chính xác — sẽ thêm 1 dòng nhỏ về options page lưu trong chrome.storage)
- Không touch crypto, auth, Yjs provider, service worker
- Không re-implement command palette / lock trong extension

## Câu hỏi cuối (nếu có)

Mode `"last"` cần postMessage từ web app — điều này nghĩa là **web app v1.1 phải deploy trước extension v1.1** thì mode "last" mới chạy được. Tôi sẽ ship cả 2 cùng lúc trong build mode này, nhưng nhớ: user đã cài extension v1.0 cũ cần update lên 1.1 mới thấy được Settings UI. Ok đúng kế hoạch?
