# Syrin Note — Side Panel (Chrome Extension)

A Manifest V3 Chrome extension that opens [note.syrin.online](https://note.syrin.online) in Chrome's side panel.

## What's new in v1.3.2

- **Ready handshake** — the panel now waits for a real `syrin:ready` postMessage from the app before hiding the loader, instead of trusting `iframe.onload`. Blank/error pages no longer look "loaded".
- **Auto-retry + diagnostics fallback** — if neither `load` nor `syrin:ready` arrive within 12 s, the panel retries once with a cache-buster. Only after that does it show the fallback, which exposes an origin/route classification (never the note path), an `/version.json` HEAD probe result, ready state, retry count, and a **Copy diagnostics** button.
- **CSP contract enforced by host** — `vercel.json` now sends `Content-Security-Policy: frame-ancestors 'self' chrome-extension://*`, and `scripts/verify-frame-ancestors.sh` runs after every deploy so the header can't silently disappear again.
- **Manifest hardening** — dropped the `tabs` permission (unused; `windowId` is available without it), added explicit `content_security_policy.extension_pages`, restricted `frame-src` to `note.syrin.online`.
- **Belt-and-suspenders click handler** — `chrome.action.onClicked` fallback opens the panel when `setPanelBehavior` is refused by policy.
- **Storage failure behavior** — `chrome.storage.sync` errors use safe defaults; note locators are not mirrored into device-local storage.

## v1.3.0

- **Unified watercolor "N" logo** — toolbar icons (16/32/48/128) and all Web Store promo assets are generated from the same source file (`icons/source.png`). Run `bash scripts/build-store-assets.sh` to rebuild.
- **Debug mode** — toggle in Settings. Adds a debug bar at the bottom of the side panel showing only locator length, postMessage acknowledgements, rejected origins/sources, and storage status. Export is always sanitized; raw locator export is unavailable. Web app honours `localStorage.syrin:debug = "1"` for bounded retry logging.
- **Playwright E2E** for the extension — `e2e-extension/` covers Alt+S → side panel URL by mode, Settings persistence + reload, and lastSlug sync from postMessage. Run with `bunx playwright test --config=e2e-extension/playwright.config.ts` (local headed Chromium).
- **JSDOM tests for `options.js`** — 11 cases covering defaults, validation, mode switching, and save success/failure.
- **STORE_LISTING.md** — copy-paste–ready Chrome Web Store fields (title, description, permission justifications, screenshots, video script, privacy answers).

## v1.2.0

- Toolbar badge `H` / `S` / `L` shows what the panel will open.
- postMessage ack + retry handshake with strict-origin targeting.
- Alt+S falls back to `chrome.windows.getCurrent()`.

## v1.1.0

- Settings page (homepage / specific slug / last opened).
- `Alt+S` keyboard shortcut.
- `?from=ext` detection (hides PWA install prompt inside the panel).

## Load unpacked (development)

1. Download / clone this folder.
2. Open `chrome://extensions` in any Chromium browser (Chrome, Edge, Brave, Arc, Opera).
3. Enable **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and pick the `chrome-extension/` folder.
5. Click the Syrin Note toolbar icon, or press `Alt+S`, to open the side panel.
6. (Optional) Right-click the toolbar icon → **Options** to set a default slug or enable "resume last note".

## Build a ZIP for the Chrome Web Store

From the repo root:

```bash
rm -f public/syrin-note-sidepanel.zip
cd chrome-extension && nix run nixpkgs#zip -- -r ../public/syrin-note-sidepanel.zip .
```

## Web Store submission checklist

- **Single purpose**: "Open Syrin Note in Chrome's side panel."
- **Permission justification**:
  - `sidePanel` — required to render the app in the side panel.
  - `storage` — syncs settings and the last-opened locator across signed-in Chrome profiles, and keeps the diagnostics opt-in/events device-local. If sync is unavailable, the panel uses safe defaults.
- **Privacy policy URL**: <https://note.syrin.online/privacy>
- **Category**: Productivity.

## Troubleshooting: "Couldn't load Syrin Note"

The fallback screen means neither the iframe `load` event nor the `syrin:ready`
handshake arrived within 12 s, twice. To diagnose:

1. Open the fallback's **Diagnostics** section. `App reachable (HEAD)` should be
   `200 ok`. If not, `note.syrin.online` is unreachable from your network.
2. Click **Copy diagnostics** and share the JSON — it includes only the app
   origin/route classification, retry count, ready state, and redacted debug
   lines; note locators and URL paths are removed.
3. If HEAD is `200 ok` but the panel still fails, check that the host sends
   `Content-Security-Policy: frame-ancestors 'self' chrome-extension://*`:
   `curl -sI https://note.syrin.online/ | grep -i frame-ancestors`.
   `scripts/verify-frame-ancestors.sh` runs this after every deploy.

### Store assets (generated, in `/mnt/documents/chrome-store/`)

- `tile-440x280.png` — small promo tile
- `marquee-1400x560.png` — marquee promo banner
- `promo-920x680.png` — large promo tile
- `screenshot-1-hero.png` — side panel next to a docs page
- `screenshot-2-settings.png` — Settings page
- `screenshot-3-default-slug.png` — `S` badge + journal note
- `screenshot-4-preview.png` — markdown editor + live preview
- `screenshot-5-lock.png` — encrypted-note unlock screen

All sized for Chrome Web Store (screenshots 1280×800). Download from `/mnt/documents/chrome-store/` and upload during submission.

### Suggested 20-second demo video script (record yourself)

| Time | Action |
| ---- | ------ |
| 0–3s | Browse any webpage in Chrome. |
| 3–5s | Press **Alt+S** — side panel slides in. |
| 5–12s | Type markdown; preview renders live in the panel. |
| 12–17s | Right-click toolbar icon → Options → set default slug → Save. Badge changes to **S**. |
| 17–20s | Close + reopen panel — it lands on the configured slug. End on the watercolor "N" logo. |

Upload as **unlisted** on YouTube, paste the URL into the Web Store listing.

## What this extension does NOT do

- No tracking, analytics, or remote scripts.
- No access to the pages you visit (no `activeTab` host permissions, no `host_permissions`, no `scripting`).
- No background data sync — it's a thin wrapper around the web app.
