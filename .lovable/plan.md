## Build "Syrin Note — Side Panel" Chrome Extension

### 1. Extension files (`chrome-extension/`)

**`manifest.json`** (MV3)
- `name`: "Syrin Note — Side Panel"
- `version`: "1.0.0"
- `minimum_chrome_version`: "114"
- `description`: English, single-purpose
- `permissions`: `["sidePanel"]` only
- `action`: `{ "default_title": "Open Syrin Note" }` (no popup — click opens side panel)
- `side_panel`: `{ "default_path": "sidepanel.html" }`
- `background`: `{ "service_worker": "background.js" }`
- `icons`: 16/32/48/128

**`background.js`**
- On `chrome.runtime.onInstalled` → `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)`

**`sidepanel.html` + `sidepanel.css` + `sidepanel.js`**
- Full-bleed `<iframe src="https://note.syrin.online">` with mobile viewport hint (`?from=ext` query so web app can detect if needed later)
- Loading spinner overlay, removed on iframe `load`
- 8s timeout: if iframe never fires `load`, show fallback panel with "Open in new tab" button → `chrome.tabs.create({ url: 'https://note.syrin.online' })`
- `<noscript>` link as ultimate fallback

**`icons/`** — 4 PNGs (16/32/48/128) generated from Stacked brand: bold "S" mark on `#0A0A0B`, neon accent. Premium quality for legibility at 16px.

### 2. Web app changes (minimal)

**`public/_headers`** — append:
```
/*
  Content-Security-Policy: frame-ancestors 'self' chrome-extension://*
```
(applied to all routes so the iframe loads inside the extension)

**`src/pages/Privacy.tsx`** — new static route `/privacy`
- Sections: What this extension does · What data we collect (none beyond what the web app already handles) · `sidePanel` permission justification · Storage isolation note (side panel storage is separate from main tab) · Contact
- Registered in `src/App.tsx` Routes

### 3. Packaging

`chrome-extension/README.md` — load unpacked steps + Web Store submission checklist (privacy URL = `https://note.syrin.online/privacy`, single-purpose description, screenshots 1280×800).

Zip command (run from `chrome-extension/`):
```
nix run nixpkgs#zip -- -r /dev-server/public/syrin-note-sidepanel.zip .
```

### What I will NOT do
- No OAuth bridge, no `externally_connectable`, no message passing (Option A confirmed)
- No changes to editor, auth, or Supabase code
- No changes to existing PWA / service worker

### Open question before I build
The `_headers` change adds `frame-ancestors 'self' chrome-extension://*` globally. This **allows any Chrome extension** to embed `note.syrin.online`. That's standard for public web apps but worth confirming. Alternative: hardcode your published extension ID after first Web Store submission (`chrome-extension://<your-id>/`) for a tighter policy. I recommend the wildcard for v1 (you don't have an ID yet) and tightening in v1.1 — OK?
