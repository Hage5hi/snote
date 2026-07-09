## Root cause

The Chrome side panel shows the "Couldn't load Syrin Note" fallback because:

1. `public/_headers` sets `Content-Security-Policy: frame-ancestors 'self' chrome-extension://*`, but the site is served through **Vercel + Cloudflare** — the Netlify/Cloudflare-Pages `_headers` file is ignored. `curl -I https://note.syrin.online/` confirms **no CSP header** is returned. Today the iframe embeds "by luck" (no explicit XFO/CSP either), but there is no guardrail preventing a future host/CDN default from blocking it.
2. `sidepanel.js` relies only on the iframe `load` event + a hard 8 s watchdog. If the first paint is slow (cold SW, cache purge, Cloudflare `__cf_bm` challenge, mobile-throttled preview), the watchdog fires and the user sees a permanent "can't embed" message — even though embedding is actually fine.
3. There is no app→panel readiness handshake. The panel treats `iframe.onload` as success, so a blank white app (SW error, hydration crash) is invisible to the extension.
4. `chrome-extension/README` and the shipped zip drift-guard advertise v1.3.1, but no automated check confirms deployed CSP + zip contents together.

## Fix (root-cause, not symptom)

### A. Guarantee the app allows embedding on every deploy

- Add `Content-Security-Policy: frame-ancestors 'self' chrome-extension://*` (and keep the existing cache rules) to `vercel.json` `headers` for `/(.*)`, so the header is actually sent by the live host.
- Keep `public/_headers` in sync as documentation for alternate hosts, and add a header comment pointing to `vercel.json` as the source of truth.
- Add a post-deploy smoke check (extend `scripts/collect-pwa-update-summary.ts` or add a tiny `scripts/verify-frame-ancestors.sh`) that curls `https://note.syrin.online/` and fails CI when `frame-ancestors` is missing or does not include `chrome-extension://*`. Wire into `.github/workflows/pwa-update-smoke-post-deploy.yml`.

### B. Make the side panel resilient and diagnosable

`chrome-extension/sidepanel.js` + `sidepanel.html`:

- Replace the single 8 s watchdog with a two-phase model:
  - **Ready handshake:** the app posts `{ type: "syrin:ready", buildId }` on mount from `src/lib/ext-context.ts` (only when `isExtensionContext` is true). Panel waits for this message, not just `iframe.onload`.
  - **Retry:** if neither `load` nor `syrin:ready` arrives in 12 s, retry once with cache-busting `?from=ext&retry=1`; only after the second failure show the fallback.
- Fallback screen shows: current iframe `src`, HTTP status of a `HEAD` probe to the app origin, and a "Copy diagnostics" button that dumps the debug log JSON. This turns a mystery failure into an actionable report.
- Log every state transition (`loading → ready`, `loading → retry`, `retry → fallback`) via `dlog()` so the existing debug bar/export captures it.

### C. App-side handshake

- In `src/lib/ext-context.ts` (or a new `src/lib/ext-handshake.ts` imported from `src/main.tsx` after mount), when `isExtensionContext`, `postMessage({ type: "syrin:ready", buildId: __BUILD_ID__ }, "*")` to `window.parent` once React has mounted the first route.
- Keep the message tiny and origin-agnostic on the sender side (panel already validates `event.origin === APP_ORIGIN`).

### D. Extension audit / polish (only the items that raise reliability or security)

- **Manifest**
  - Add `"content_security_policy": { "extension_pages": "script-src 'self'; object-src 'self'" }` (MV3 default is already strict, this locks it in).
  - Drop `"tabs"` permission — `chrome.tabs.query({active,currentWindow})` works with `activeTab` alone; smaller install-prompt.
  - Bump `version` to `1.3.2` and update `public/syrin-note-sidepanel.zip.manifest.json` via `scripts/verify-extension-zip.sh`.
- **background.js**: also register `chrome.action.onClicked` as a belt-and-suspenders fallback in case `setPanelBehavior` rejects on older channels; today only Alt+S works if that call fails.
- **sidepanel.js**: guard `chrome.storage.sync.get` with a `chrome.runtime.lastError` check + local-storage fallback (sync can be disabled by enterprise policy — currently that path silently loads defaults with no signal).
- **e2e-extension**: add `iframe-load.spec.ts` that stubs `APP_ORIGIN` to a local Playwright-served page which posts `syrin:ready`, and asserts the loader hides + fallback stays hidden. Add a second spec that never posts `ready`, and asserts the retry then fallback happens with diagnostics populated.
- **CI**: extend `.github/workflows/extension-e2e.yml` to also run `scripts/verify-extension-zip.sh` so version/hash drift blocks the PR.

### E. Docs

- `chrome-extension/README.md`: document the readiness handshake, retry behaviour, and the CSP contract the host must send. One short "If the side panel shows Couldn't load" troubleshooting section pointing at the diagnostics export.

## Files to touch

```
vercel.json                              (add CSP + frame-ancestors)
public/_headers                          (comment: source of truth is vercel.json)
scripts/verify-frame-ancestors.sh        (new, curl assertion)
.github/workflows/pwa-update-smoke-post-deploy.yml  (call the script)
.github/workflows/extension-e2e.yml      (run verify-extension-zip.sh)
chrome-extension/manifest.json           (v1.3.2, drop "tabs", add extension_pages CSP)
chrome-extension/background.js           (action.onClicked fallback)
chrome-extension/sidepanel.html          (diagnostics button in fallback)
chrome-extension/sidepanel.js            (ready handshake + retry + diagnostics)
chrome-extension/README.md               (handshake + troubleshooting)
public/syrin-note-sidepanel.zip + .manifest.json    (regen via script)
src/lib/ext-context.ts                   (export a small postReady() helper)
src/main.tsx                             (call postReady() after mount when in ext)
e2e-extension/iframe-load.spec.ts        (new, happy path + retry/fallback)
```

## Verification

1. `curl -I https://note.syrin.online/ | grep -i frame-ancestors` returns the expected CSP after deploy.
2. Extension E2E: happy-path spec sees `loader` hide within 2 s of the stub posting `syrin:ready`; retry spec sees fallback with a non-empty diagnostics payload after 2 × 12 s.
3. Manual: load unpacked in Chrome, Alt+S opens panel, `note.syrin.online` renders, debug bar (when enabled) shows `ready received buildId=…`.
4. `scripts/verify-extension-zip.sh` passes; CI extension-e2e job stays green.

## Explicitly out of scope

- No functional changes to the note editor or backend.
- No new permissions added; only removing `tabs` if audit confirms no consumer.
- No visual redesign of the panel; only the fallback gets a "Copy diagnostics" button.
