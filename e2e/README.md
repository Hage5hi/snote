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

Use `helpers/pwa-update-mock.ts` to control build IDs, polling and reload
transitions. The post-deploy workflow runs:

- `pwa-update-production-readonly.spec.ts` only.

The production spec is gated by `POST_DEPLOY_SMOKE=1`. It performs a real
`GET /version.json` with `Cache-Control: no-store`, verifies the returned
`buildId`, and then exercises only `/privacy?v=legacy-noise&foo=bar`. Its
`helpers/production-readonly.ts` guard permits only GET/HEAD/OPTIONS, blocks
Supabase and API paths, closes every WebSocket, and records only
`{method, origin, pathname}`. `serviceWorkers: "block"` is part of the spec.
The workflow also verifies that the checkout SHA equals `EXPECTED_DEPLOYED_SHA`.

`version.json` currently exposes a provider build ID and build timestamp, not a
source commit SHA. The smoke therefore proves the checked-out SHA and the live
build ID independently; it does not invent a source-SHA field or trust an
unverified provider environment variable.

The ordinary local/CI suite still runs:

- `pwa-update-multi-click.spec.ts`
- `pwa-update-no-url-v-param.spec.ts`

The smoke fails if a stalled worker destroys the active offline app or if an
update adds cache-buster query parameters to note URLs.

## Environment overrides

See [E2E environment overrides](../docs/e2e-env-overrides.md) for the supported
Yjs and PWA timing inputs. Keep production defaults in source and override only
through the documented test hooks.
