# Syrin Note — Side Panel (Chrome Extension)

A Manifest V3 Chrome extension that opens [note.syrin.online](https://note.syrin.online) in Chrome's side panel.

## Load unpacked (development)

1. Download / clone this folder.
2. Open `chrome://extensions` in any Chromium browser (Chrome, Edge, Brave, Arc, Opera).
3. Enable **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and pick the `chrome-extension/` folder.
5. Click the Syrin Note toolbar icon to open the side panel.

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
- **Privacy policy URL**: <https://note.syrin.online/privacy>
- **Screenshots**: 1280×800, at least one showing the side panel open next to a page.
- **Category**: Productivity.

## What this extension does NOT do

- No tracking, analytics, or remote scripts.
- No access to the pages you visit (no `activeTab`, `tabs`, `host_permissions`, `scripting`).
- No background data sync — it's a thin wrapper around the web app.
