## Scope

Three independent additions on top of the existing `InstallPrompt` redesign:

1. **i18n** — extract every hardcoded English string in `src/components/note/InstallPrompt.tsx` (status labels, status reasons, app/extension step labels, aria-labels) into `src/i18n/index.ts` and translate into all 9 configured locales: `en, vi, zh, ja, ko, fr, es, de, pt`.
2. **Playwright a11y** — assert keyboard navigation, focus trapping, and ARIA labels on the install dialogs and on the non-dismissible panel itself.
3. **Visual regression** — assert the panel’s 2-col → 1-col responsive layout does not overflow or misalign on small screens.

No business-logic or UX changes — only string externalisation + new tests.

## i18n keys to add (≈22 per locale)

Status (install-as-app dialog):
- `install.status_installed_label`, `install.status_installed_reason`
- `install.status_ready_label`, `install.status_ready_reason`
- `install.status_ios_label`, `install.status_ios_reason`
- `install.status_firefox_label`, `install.status_firefox_reason`
- `install.status_waiting_label`, `install.status_waiting_reason`
- `install.status_unsupported_label`, `install.status_unsupported_reason`

App steps (platform-specific):
- `install.app_step_ios_1..4`
- `install.app_step_desktop_1`, `install.app_step_android_1`, `install.app_step_chromium_2..4`

Extension steps:
- `install.ext_step_download`, `install.ext_step_unzip`, `install.ext_step_devmode`, `install.ext_step_loadunpacked`

A11y:
- `install.panel_label` ("Install options")
- `install.step_completed`, `install.step_mark`

Refactor `InstallPrompt.tsx` so every visible string and `aria-label` reads from `t(...)`. Add `role="region"` + `aria-label={t("install.panel_label")}` to the panel root so the non-dismissible region is a discoverable landmark.

## Playwright — a11y spec

New file: `e2e/install-prompt-a11y.spec.ts`.

- **Panel landmark + non-dismissible**: assert `[data-testid="install-prompt"]` is rendered, has `role="region"` and a localized `aria-label`, and has no close button (`button[aria-label*="close" i]`) inside it.
- **Trigger buttons**: each has accessible name (install-as-app, browser-extension).
- **Keyboard open**: Tab to the install-as-app trigger, press Enter, assert dialog open + initial focus inside dialog.
- **Focus trap**: cycle Tab through dialog, assert focus stays inside `[role="dialog"]`.
- **Escape closes** dialog and returns focus to the trigger.
- **Step buttons aria-label**: assert each step toggle has an accessible name (`Mark step` / `Completed`).
- Run an axe scan with the dialog open; assert no new serious/critical violations beyond a baseline taken before opening.

## Playwright — responsive visual regression

New file: `e2e/install-prompt-responsive.spec.ts`.

Three viewports: 360×800 (mobile), 640×900 (sm breakpoint boundary), 1024×900 (desktop).

For each:
- Scroll panel into view.
- Assert no horizontal overflow: `scrollWidth <= clientWidth` on the panel and on `document.documentElement`.
- Assert layout shape:
  - <640: `grid-template-columns` resolves to a single track (1-col).
  - ≥640: two equal tracks (2-col) with a visible vertical divider; both trigger buttons share the same `offsetTop` (alignment guard).
- Pixel-diff screenshot of the panel only (`getByTestId('install-prompt').screenshot(...)`) via `toHaveScreenshot` with `maxDiffPixelRatio` from `diffRatio()` helper, snapshot per-viewport.

Snapshots are committed under `e2e/__screenshots__/install-prompt-responsive.spec.ts/` on first green run.

## Verification

- `tsgo` typecheck.
- `bunx vitest run src/i18n/__tests__/i18n-coverage.test.tsx` to confirm every new key is present in all 9 locales.
- `bunx playwright test e2e/install-prompt-a11y.spec.ts e2e/install-prompt-responsive.spec.ts --update-snapshots` (first run) then re-run to confirm green.

## Out of scope

- No changes to `InstallPrompt` behaviour, layout classes, or dialog content beyond extracting strings.
- No new translations for the existing pre-redesign keys.
- No changes to extension-side Playwright suite (`e2e-extension/`).
