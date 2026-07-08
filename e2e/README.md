# E2E Test Suite

Runs against `bun run dev` (Vite) via `bunx playwright test`. See
`playwright.config.ts` for projects, retries (0), and artifact retention
(`trace: retain-on-failure`, `screenshot: only-on-failure`, `video: retain-on-failure`).

For environment-variable overrides (Yjs debounce, stress-rename seed,
multi-tab observer window, PWA update tunables) see
[`docs/e2e-env-overrides.md`](../docs/e2e-env-overrides.md).

## PWA update specs

- `pwa-update-toast.spec.ts` — happy path: toast appears on version mismatch,
  clears only after the running `buildId` actually equals the remote one.
- `pwa-update-throttle.spec.ts` — rapid clicks fire exactly one reload, toast
  never flickers back to "New version available". On failure attaches
  `pwa-update-throttle-failure.png` + `-toast.html` alongside the retained
  trace/video.
- `pwa-update-hard-reload.spec.ts` — forces the hard-reload fallback path
  (no waiting SW) and asserts `reloadAttemptCount === 1` and the toast clears
  after buildId transitions.

### `test-results/pwa-update-summary.json`

Produced by `bun run scripts/collect-pwa-update-summary.ts` and uploaded as a
CI artifact. Consolidates every `pwa-update-*.json` attachment from all PWA
specs into one file.

```jsonc
{
  "generatedAt": "2026-07-07T…",       // ISO timestamp of the summary run
  "sampleCount": 6,                      // total pwa-update-*.json attachments found
  "buildIdMismatchCount": 2,             // samples where pending !== current
  "samples": [
    {
      "file": "playwright-report/data/…/pwa-update-after-click.json",
      "label": "after-click",           // derived from the attachment filename
      "currentBuildId": "build-v1",     // POLLING value: window.__SNOTE_PWA_UPDATE_STATE__.currentBuildId
      "pendingBuildId":  "build-v2",    // POLLING value: latest remote buildId seen by the version poller
      "reloadAttemptCount": 1,          // times reloadNow() ran (throttle indicator)
      "reloadStrategy": "hard",         // "waiting-sw" | "hard" | null — which reload path was taken
      "updateAvailable": true,          // poller flag: remote buildId != current
      "updateInProgress": true,         // reloadNow() started, transition not confirmed yet
      "toastText": "New version available\nReload to get the latest version..." // TOAST value (from DOM; no build IDs)
    }
  ],
  "buildIdMismatches": [ /* subset of samples where pendingBuildId !== currentBuildId */ ]
}
```

**Toast vs polling buildId mapping:**

| Source              | Field in summary                          | Origin |
| ------------------- | ----------------------------------------- | ------ |
| Polling (in-memory) | `samples[].currentBuildId`                | `window.__SNOTE_PWA_UPDATE_STATE__.currentBuildId` (from `__BUILD_ID__` or E2E override) |
| Polling (remote)    | `samples[].pendingBuildId`                | Latest `buildId` returned by `/version.json` |
| Toast (rendered)    | `samples[].toastText`                     | `innerText` of `[data-sonner-toast]`; user-facing copy only, while build IDs stay in debug state |

A `buildIdMismatchCount > 0` at the end of a run means at least one toast was
still showing a pending build that hadn't taken effect — usually the smoking
gun for "clicked Update but nothing changed" reports.

## Cross-browser matrix

`pwa-update-toast.spec.ts`, `pwa-update-throttle.spec.ts`, and
`pwa-update-hard-reload.spec.ts` are cross-browser: the CI matrix
(`.github/workflows/e2e.yml`) runs them under chromium, firefox, and webkit
via `PLAYWRIGHT_PROJECT`. Locally, override with:

```sh
PLAYWRIGHT_PROJECT=firefox bunx playwright test e2e/pwa-update-throttle.spec.ts
PLAYWRIGHT_PROJECT=webkit  bunx playwright test e2e/pwa-update-hard-reload.spec.ts
```

## Deterministic PWA update mock

Use `installPwaUpdateMock(page, { fromBuildId, toBuildId, holdHardReload })`
from `e2e/helpers/pwa-update-mock.ts` — it sets fixed buildIds, fixed poll
intervals (10ms initial / 250ms interval), and optionally holds the hard-reload
event until `releaseHeldReload(page)` runs. No `Date.now()` or randomness in
the setup, so results are repeatable across runs and browsers.

## In-app debug helper

Paste `__SNOTE_PWA_UPDATE_DEBUG__()` into the browser devtools console to log
a `[pwa-update:lifecycle]` payload showing current vs pending buildId and the
selected reload strategy. The same payload is auto-logged at each toast
lifecycle transition (`toast-shown`, `reload-start`, `transition-complete`).

## CI failure artifacts

On failure, `.github/workflows/e2e.yml` uploads a dedicated
`pwa-update-failures-<browser>-run<N>-attempt<M>` artifact containing the
Playwright trace, screenshots, videos, and JSON attachments for just the
PWA update specs — no need to download the full `test-results/` archive.

## Dev PWA update debug panel

`src/components/dev/PwaUpdateDebugPanel.tsx` renders a small floating panel
in the bottom-right corner of the app that mirrors
`window.__SNOTE_PWA_UPDATE_STATE__`. It only mounts when
`import.meta.env.DEV` is true — i.e. under `bun run dev` or
`bunx playwright test` (which uses the Vite dev server), never in a
production build.

Enable DEV mode locally:

```sh
bun run dev              # panel appears at http://localhost:8080
```

Fields (collapsed header shows `[pwa] <current> → <pending>`):

| Field         | Meaning |
| ------------- | ------- |
| `current`     | `__BUILD_ID__` baked into the running bundle (or the E2E override). |
| `pending`     | Latest remote `buildId` returned by `/version.json`; `—` when unset. |
| `strategy`    | `waiting-sw` if a waiting service worker was activated, `hard` for the hard-reload fallback, `—` before a reload has been attempted. |
| `attempts`    | `reloadAttemptCount` — number of times `reloadNow()` has fired. Throttle indicator. |
| `last remote` | `lastRemoteBuildId` — last `buildId` the poller saw from `/version.json`, even if it matches `current`. |
| `inProgress`  | `updateInProgress` — `reloadNow()` has started and the buildId transition has not been confirmed. |

## Readiness gate

Before the PWA update specs click the toast's Update button, they wait for
the service worker to reach `registered` + `activated`. If registration
stalls past the configured timeout, the spec fails fast with a
`pwa-updater-not-ready.json` attachment listing the last observed SW state,
so retries don't paper over a broken registration. See
`e2e/pwa-update-sw-stall.spec.ts` for the reference stall scenario.

