# Syrin Note Side Panel — v1.3.5

## Highlights

- **Fallback reason resolver** — the overlay now shows a precise,
  single-line reason for every failure mode (handshake protocol
  mismatch, CSP block, or missing `syrin:ready`) with a defined
  priority order. Extracted to a pure, unit-tested helper
  (`lib/fallback-reason.js`).
- **CSP probing** — `verifyFrameAncestorsCsp()` reports the exact CSP
  violation ("missing frame-ancestors", "excludes chrome-extension://",
  "no CSP header"). Results are cached for 5 s to halve fallback
  latency.
- **Shared handshake constants** — `APP_ORIGIN`, `HANDSHAKE_PROTOCOL`,
  min/max protocol bounds, and `DEFAULT_LOAD_TIMEOUT_MS` live in
  `lib/handshake-constants.js`. Mirrored in `src/lib/ext-context.ts` to
  prevent drift.
- **Copy diagnostics button** on the fallback overlay — puts a
  schema-valid, sanitized JSON bundle on the clipboard for one-click
  triage.
- **Telemetry bounds check** — each recorded event is capped at 512
  bytes serialized to prevent `chrome.storage.local` bloat.
- **Test overrides** — `window.__SYRIN_TEST_TIMEOUT_MS` lets E2E specs
  bypass the 12 s watchdog.

## Developer docs

See [`docs/extension-fallback-diagnostics.md`](../docs/extension-fallback-diagnostics.md)
for the full troubleshooting guide covering banner priority, CSP probe
reasons, and diagnostics bundle interpretation.

## Test coverage

- Unit: `fallback-reason.test.js`, `diagnostics-schema.test.js`
  (including forbidden-key denylist).
- E2E: `copy-diagnostics.spec.ts`, `copy-diagnostics-clipboard.spec.ts`,
  `csp-blocked-overlay.spec.ts`, `version-mismatch-overlay.spec.ts`,
  `no-console-errors.spec.ts` (deterministic waits).
- CI: extension build artifacts + Playwright traces/screenshots/videos
  upload on failure.
