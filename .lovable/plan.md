# Plan

Two independent tracks. Both ship together.

## Track A — Extension: tests & export coverage

### 1. Unit tests for `chrome-extension/lib/redact.js`
- New file `chrome-extension/lib/__tests__/redact.test.js` (Vitest, run by existing root Vitest config which already includes `src/**` — extend `vitest.config.ts` `test.include` to also match `chrome-extension/**/*.test.js`).
- One `describe` per `REDACTION_RULES` entry. Each test = explicit `{ input, expected }` fixture pair so any weakening of a regex flips the assertion. Rules covered: `url`, `email`, `jwt`, `bearer`, `api-key-prefixed`, `uuid`, `fs-path`, `username-at`, `labeled-slug`, `long-token`, plus `maskToken`, `redactUrl`, `redactPayload` (asserts `lastSlug` masked, `iframeSrc` reduced to origin, `lines[].msg` redacted, `redacted: true`).
- Include negative fixtures (e.g. short tokens unchanged, plain words not matched) so over-broad changes also fail.

### 2. Playwright: filename contract across versions and modes
- Extend `e2e-extension/redacted-export.spec.ts` (or new `export-filename.spec.ts`).
- Trigger export twice (redacted off / on). For each, capture the `download` event, compute `expectedFilename({ redacted, isoTimestamp })` in-page via `page.evaluate` importing `export-schema.js`, assert downloaded name === expected and matches `isExpectedFilename`.
- Parameterize over multiple `EXPORT_VERSION` values by stubbing the module: before navigation, use `page.route` on `**/lib/export-schema.js` to rewrite `EXPORT_VERSION` to `[1, 2, 99]`. Assert the JSON payload's `version` field and that filename logic still passes `isExpectedFilename`.

### 3. Playwright: toggle persistence across reload
- New spec `e2e-extension/redaction-persist.spec.ts`: open side panel → toggle redaction ON → reload side panel page → assert checkbox still checked (state lives in `chrome.storage.local`; if not yet, add a small `chrome.storage.local.set/get` for the toggle in `sidepanel.js`) → export → assert filename contains `-redacted-` and payload validates against `validateExport` with `redacted: true`.

### 4. Playwright: copy-to-clipboard + alternate export paths
- `debug-copy` button currently calls `navigator.clipboard.writeText(text)` with the **raw** buffer. Update `sidepanel.js` so the copy path runs the same `redactPayload`/`redactLine` pipeline when the redaction toggle is on, producing JSON identical in shape to the download.
- New spec `e2e-extension/export-paths.spec.ts`: grant `clipboard-read`, toggle redaction on, click copy, read `navigator.clipboard.readText()`, parse JSON, assert `validateExport(...).ok` and that `lastSlug`/`iframeSrc` are masked exactly like the downloaded file. Repeat with redaction off and assert identical raw values across both export methods.

## Track B — Install panel UX (`src/components/note/InstallPrompt.tsx` + i18n)

### 1. Non-dismissible, install-aware
- Remove any close affordance. Dialogs stay opt-in via the two trigger buttons, but the outer panel itself has no X and no localStorage dismissal (already true — keep it that way and add a comment so it isn't reintroduced).
- Listen to `appinstalled` event + `matchMedia('(display-mode: standalone)')` change. When installed: the "Install as an app" button switches to a success state ("Installed ✓", disabled, hint text "Open from your home screen / app launcher"). Right-hand extension column stays available.

### 2. Responsive 2-column layout
- Outer panel: `max-w-xl` on desktop, `grid-cols-2` from `sm:` up, `grid-cols-1` below. `min-w-0` on each cell + `truncate`/`break-words` on labels so nothing overflows on narrow widths.
- Dialog content: `sm:max-w-md`, body wrapped in `max-h-[70vh] overflow-y-auto` so the checklist + download button never push off-screen on short viewports.

### 3. Platform-aware install dialog
- Detect capability up front: `canPrompt = !!bipEvent` (Chrome/Edge desktop, Android Chrome), `isIosSafari`, `isFirefox`, `isStandalone`.
- Dialog header shows a status row:
  - Supported + prompt ready → green dot + "Ready to install" + `Install` button.
  - Supported browser but prompt not yet fired → amber dot + "Waiting for browser…" + explanation (interact with the site / visit again later).
  - iOS Safari → blue dot + Share-sheet instructions.
  - Firefox / unsupported → grey dot + "Your browser does not support one-click install" + manual steps.
  - Already installed → check + "Installed".
- Each branch renders its own dedicated step list (see below).

### 4. Live 4-step checklists (both dialogs)
- Reusable `<StepList steps={[{label, done}]}/>` rendering a checkbox/check icon per step.
- **Install-as-app steps** vary per branch:
  - Chrome/Edge desktop: 1) Open this site in Chrome/Edge → auto-done, 2) Click **Install** → flips done after `bipEvent.userChoice` resolves accepted, 3) Confirm browser dialog → done on `appinstalled`, 4) Launch from app launcher → done when `display-mode: standalone` becomes true.
  - Android Chrome: same shape, step 1 detects Android UA.
  - iOS Safari: 1) Open in Safari (auto), 2) Tap Share, 3) Tap "Add to Home Screen", 4) Open from home screen (flips on standalone).
- **Extension steps**: 1) Download `.zip` → flips done after successful fetch, 2) Unzip, 3) Open `chrome://extensions` + enable Developer mode, 4) Click **Load unpacked** and select the folder. Steps 2-4 expose a "Mark done" checkbox the user can tick; state persists in `localStorage` keyed `install.ext.steps` so progress survives reload.

### 5. i18n
- Add keys for each new string in all 9 locales already present in `src/i18n/index.ts`: `install.status_ready`, `install.status_waiting`, `install.status_ios`, `install.status_unsupported`, `install.status_installed`, `install.waiting_reason`, `install.unsupported_reason`, `install.app_step1..4` per platform (`app_step_chrome_1` etc.), `install.ext_mark_done`. Reuse existing `install.ext_step1..4`.

## Verification

- `bunx vitest run chrome-extension/lib/__tests__/redact.test.js`
- `bunx playwright test --config e2e-extension/playwright.config.ts` (filename, persistence, export-paths specs)
- Manual Playwright screenshot pass on the homepage at 360px, 640px, 1024px widths to confirm no overflow and both dialogs scroll cleanly.
- Toggle Chrome DevTools "App installed" emulation to verify the installed state copy appears.

## Out of scope

- No changes to `sidepanel.html` styling beyond what the copy-path redaction parity requires.
- No new dependencies (no Ajv, no extra UI libs).
- No changes to `manifest.json` permissions besides `clipboardRead` if not already granted (already present per recent changes — verify before adding).
