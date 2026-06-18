# Extension E2E (Playwright)

Standalone Playwright suite that loads `chrome-extension/` as an unpacked
extension in a persistent Chromium context. Lives outside the main `e2e/`
suite so it doesn't run in CI by default — it requires headed Chromium.

## Run locally

```bash
bunx playwright install chromium
bunx playwright test --config=e2e-extension/playwright.config.ts
```

## What's covered

| Spec | What it verifies |
|------|------------------|
| `alt-s.spec.ts` | `chrome.sidePanel.open({windowId})` opens the side panel with the URL `buildSrc()` computes for each `openMode` (home/slug/last). |
| `settings-reload.spec.ts` | Saving Settings persists to `chrome.storage.sync` and values are restored after page reload. |
| `last-slug-sync.spec.ts` | `postMessage({type:"syrin:slug"})` from the embedded app is validated by origin and written to `lastSlug`. |

## Known limitation

The Alt+S keyboard shortcut itself can't be triggered by Playwright — the
Chrome commands API requires a real user gesture. The `alt-s.spec.ts` runs
the exact code path the command handler executes (`chrome.sidePanel.open`)
inside the service worker, which is what we need to regression-guard.

For end-to-end verification of the keyboard shortcut, do it manually:

1. Load `chrome-extension/` as unpacked.
2. Open any tab.
3. Press `Alt+S` — side panel should open.
