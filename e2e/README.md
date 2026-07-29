# App E2E tests

Playwright starts the Vite development server and keeps global retries at zero.
Local runs default to Chromium:

```sh
bun run test:e2e
```

Select a browser explicitly:

```sh
PLAYWRIGHT_PROJECT=firefox bun run test:e2e
PLAYWRIGHT_PROJECT=webkit bun run test:e2e
```

PR CI runs these critical Chromium specs:

- `critical-a11y.spec.ts`
- `pwa-update-sw-stall.spec.ts`

Pushes to `main`, nightly runs and manual dispatches run the complete suite
under Chromium, Firefox and WebKit. The complete suite is deliberately small:
critical accessibility and split-layout coverage, install UX, PWA update
recovery, direct theme switching, and WebGL fallback. CI never retries a
failing test.

## Deterministic async tests

Prefer observable conditions to elapsed time:

- `expect(locator).toBeVisible()` for UI readiness.
- `expect.poll()` for browser state and cross-tab propagation.
- `page.waitForFunction()` for explicit application latches.
- fake clocks for debounce and interval behavior.

Do not add fixed sleeps to make a flaky assertion pass. Failure evidence is
retained through Playwright traces, screenshots and video.

## PWA update tests

Local mocked specs use `helpers/pwa-update-mock.ts` to control build IDs,
polling and UI transitions. The post-deploy workflow runs:

- `pwa-update-production-readonly.spec.ts` only.

The production spec is gated by `POST_DEPLOY_SMOKE=1`. It performs a real
`GET /version.json` with `Cache-Control: no-store`, verifies the returned
diagnostic `buildId` and source-stamped `deployedSha`, and then exercises only
`/privacy?v=legacy-noise&foo=bar`. This production smoke uses the current
deployed real service worker: it verifies registration, activation, the exact
same-origin `/sw.js` script and root scope, then reloads offline `/privacy`
through the active worker/cache. It does not claim to test an A-to-B update.

Its `helpers/production-readonly.ts` BrowserContext guard permits only
GET/HEAD/OPTIONS for the exact static precache boundary, blocks Supabase, API,
analytics, arbitrary note/capability routes and all WebSockets, and records
only sanitized `{method, origin, pathname}` evidence. The workflow also
verifies that the approved manifest candidate, checked-out commit, and live
`deployedSha` all equal `EXPECTED_DEPLOYED_SHA`.

The workflow can be invoked by authenticated `repository_dispatch` or explicit
`workflow_dispatch`. This repository currently has no automatic Lovable
publish emitter, so a verified Lovable publish must be followed by one of
those explicit dispatch paths; a Git push alone is not treated as deployment.

A clean Git-backed normal build may embed its exact lowercase 40-character
checked-out HEAD. A dirty or Git-less build, an invalid HEAD, or a failed Git
status check emits `"deployedSha": null` without fabricating identity. The
controlled path remains `bun run build:release` with an exact commit SHA in
`SNOTE_RELEASE_SHA`; it fails closed for missing, malformed, partial, or
checked-out-Git-mismatched release identity.

A Lovable preview/staging rehearsal is still required to determine whether its
builder exposes clean Git metadata. The current production artifact is not
source-attested. A provider `build_id` remains diagnostic only and cannot
substitute for the source stamp.
The stamp is not a signing system: it is valid only when the deployment
environment that injects it is access-controlled and the post-deploy smoke has
verified the live artifact.

The ordinary local/CI suite still runs:

- `pwa-update-multi-click.spec.ts`
- `pwa-update-no-url-v-param.spec.ts`

These local mocked specs cover update UI transitions and URL hygiene. They
cannot make that claim for a real worker lifecycle or rollback.
A separate local two-build real harness is planned next; it is not yet
implemented.
The current repository therefore does not yet provide real A-to-B activation
or stalled-worker rollback proof, and the production smoke deliberately does
not make those claims.

## Environment overrides

See [E2E environment overrides](../docs/e2e-env-overrides.md) for the supported
Yjs and PWA timing inputs. Keep production defaults in source and override only
through the documented test hooks.
