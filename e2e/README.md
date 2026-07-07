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
      "toastText": "New version available\nCurrent: build-v1\nPending: build-v2" // TOAST value (from DOM)
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
| Toast (rendered)    | `samples[].toastText`                     | `innerText` of `[data-sonner-toast]`; contains `Current: …` / `Pending: …` lines rendered from the same state |

A `buildIdMismatchCount > 0` at the end of a run means at least one toast was
still showing a pending build that hadn't taken effect — usually the smoking
gun for "clicked Update but nothing changed" reports.
