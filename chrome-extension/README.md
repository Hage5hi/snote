# Syrin Note — Side Panel (Chrome Extension)

A Manifest V3 Chrome extension that opens [note.syrin.online](https://note.syrin.online) in Chrome's side panel.

## What's new in v1.1.0

- **Settings page** — choose what opens when the side panel launches: the homepage, a specific default slug, or the last note you had open. Right-click the toolbar icon → **Options**.
- **Keyboard shortcut** — `Alt+S` opens the side panel. Customize at `chrome://extensions/shortcuts`.
- **Resume last note** — when enabled, the panel reopens on the note you last visited (synced via `chrome.storage.sync`).
- **`?from=ext` detection** — the web app now hides the "Install PWA" prompt when running inside the extension.

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
  - `storage` — saves your settings (default slug, last-opened note) and syncs them across your signed-in Chrome profiles.
- **Privacy policy URL**: <https://note.syrin.online/privacy>
- **Screenshots**: 1280×800, at least one showing the side panel open next to a page.
- **Category**: Productivity.

## What this extension does NOT do

- No tracking, analytics, or remote scripts.
- No access to the pages you visit (no `activeTab`, `tabs` host permissions, `host_permissions`, `scripting`).
- No background data sync — it's a thin wrapper around the web app.
