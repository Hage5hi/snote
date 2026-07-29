# E2E environment overrides

Keep timing deterministic and prefer application latches, `expect.poll()` or
fake clocks over fixed sleeps.

## Yjs persistence

`YJS_SNAPSHOT_DEBOUNCE_MS` controls the legacy snapshot compatibility debounce.
Resolution order:

1. `localStorage["syrin:yjs-snapshot-debounce-ms"]`
2. `VITE_YJS_SNAPSHOT_DEBOUNCE_MS`
3. `process.env.YJS_SNAPSHOT_DEBOUNCE_MS`
4. production default: `800`

Capability notes persist idempotent Yjs updates through the acknowledged
IndexedDB outbox. Tests may shorten timing but must still wait for server
acknowledgement before treating an update as durable.

## PWA updates

The application accepts these positive millisecond values:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `VITE_PWA_VERSION_POLL_MS` | `60000` | `/version.json` polling |
| `VITE_PWA_SW_POLL_MS` | `60000` | service-worker update polling |
| `VITE_PWA_RELOAD_FALLBACK_MS` | `2500` | verified transition fallback |

Playwright PWA specs should use `e2e/helpers/pwa-update-mock.ts`, which exposes
deterministic build IDs and transition latches. Do not reduce a timeout merely
to hide an update that has not reached the verified state.

The real lifecycle suite is intentionally separate:

```sh
bun run test:e2e:pwa-transition
```

It owns the fixed loopback port `4178`, generates both builds under
`.tmp/pwa-transition/`, permits only the exact internal build IDs
`pwa-e2e-a`/`pwa-e2e-b`, and cannot coexist with release-attestation
variables. Its control endpoint is loopback-only and token-gated. The test
server keeps `/version.json?source=network` live while it can hold or reject
the exact unqueried `/version.json` fetch that Workbox performs during B's
install; Workbox uses `__WB_REVISION__` as the cache key, not as that network
request URL.

## Browsers

- `PLAYWRIGHT_PROJECT=chromium|firefox|webkit` selects one project.
- `PLAYWRIGHT_BASE_URL` targets an existing deployment.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects a compatible Chromium build.

Global retries are always zero in local and CI runs.
