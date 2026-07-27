# Syrin Note Side Panel — Fallback & Diagnostics Guide

Developer troubleshooting reference for the Chrome extension's fallback
overlay, CSP probing, and diagnostics bundle. Introduced in extension
**v1.3.5**.

## Overview

When the embedded app (`https://note.syrin.online`) fails to hand shake
with the side panel, the panel switches from the iframe view to a
**fallback overlay**. The overlay shows a single-line **reason banner**
and exposes two actions:

- **Copy diagnostics** — puts a sanitized JSON bundle on the clipboard.
- **Download diagnostics JSON** — saves the same bundle to disk.

Both paths produce the identical bundle validated against
`chrome-extension/lib/diagnostics-schema.js`.

## The reason banner

The banner text is produced by the pure resolver
[`chrome-extension/lib/fallback-reason.js`](../chrome-extension/lib/fallback-reason.js)
(`resolveFallbackReason(...)`). Priority order — first match wins:

1. **Handshake protocol mismatch** —
   `"Handshake protocol mismatch: <reason>"`
   The app posted `syrin:ready` with a `protocol` outside
   `[MIN_APP_PROTOCOL, MAX_APP_PROTOCOL]` (currently `[1, 2]`).
2. **CSP block** —
   `"App CSP blocks embedding: <reason>"`
   `verifyFrameAncestorsCsp` found no CSP header, no `frame-ancestors`
   directive, or the directive excludes `chrome-extension://`.
3. **No ready message** —
   `"App never sent syrin:ready after N retry(ies). App reachable = <status>."`
   Watchdog timeout (default `DEFAULT_LOAD_TIMEOUT_MS = 12000` ms) with
   no valid handshake.

If none of the above apply, the resolver returns `null` and no overlay
is shown.

## CSP probing

`verifyFrameAncestorsCsp()` in `chrome-extension/sidepanel.js` performs
a HEAD fetch against `APP_ORIGIN` and inspects the
`content-security-policy` response header. Result shape:

```ts
{ ok: boolean; reason: string | null }
```

The probe result is cached in-memory for **5 seconds** to avoid a double
fetch during fallback rendering. Reasons surfaced verbatim in the
banner include:

- `"missing frame-ancestors"`
- `"frame-ancestors excludes chrome-extension://"`
- `"no CSP header"`

## Interpreting a copied diagnostics bundle

The bundle is JSON with a fixed set of top-level keys (any extra key
would be a leak — the E2E suite asserts the set exactly):

| Key                  | Meaning                                                 |
| -------------------- | ------------------------------------------------------- |
| `kind`               | Always `"syrin-note-sidepanel-diagnostics"`             |
| `schemaVersion`      | Currently `1`                                           |
| `at`                 | ISO timestamp when the bundle was built                 |
| `extensionVersion`   | From `manifest.json`                                    |
| `handshake`          | Protocol/status fields; `appBuildId` and mismatch text are classified/redacted |
| `load`               | `iframeSrc` contains only origin/route class; plus load/retry status |
| `cspFrameAncestors`  | Last `verifyFrameAncestorsCsp` result                   |
| `messageTimeline`    | Ordered handshake/postMessage events                    |
| `telemetry`          | Ring-buffered privacy-safe events (opt-out respected)   |
| `telemetryEnabled`   | User opt-in state                                       |
| `debugLines`         | Recent debug log lines                                  |

Sanitization is applied before validation and before either clipboard or
download serialization. No note slugs, URL paths, note bodies, tokens,
sessions, raw build identifiers, attacker-controlled error text, or emails
appear anywhere. Debug export has no raw mode. The E2E suite injects sentinel
secrets and applies a denylist to every serialized export surface.

### Triage flow

1. Read `handshake.versionMismatch` — `protocol-mismatch` means protocol drift.
   Cross-check `handshake.appProtocol` vs `handshake.extensionProtocol`.
2. Read `cspFrameAncestors.reason` — if non-null, the app CSP is
   blocking embedding regardless of protocol.
3. If both are clean, look at `load.retryCount` and `messageTimeline`
   for the missing `syrin:ready`.

## Testability hooks

- `window.__SYRIN_TEST_TIMEOUT_MS` — overrides
  `DEFAULT_LOAD_TIMEOUT_MS` so E2E fallback specs finish in seconds
  instead of 12 s per retry.

## Related files

- `chrome-extension/lib/handshake-constants.js` — single source of
  truth for `APP_ORIGIN`, `HANDSHAKE_PROTOCOL`, min/max protocol bounds,
  and the watchdog timeout. Mirrored (kept in sync) in
  `src/lib/ext-context.ts`.
- `chrome-extension/lib/fallback-reason.js` — pure resolver (unit
  tested in `chrome-extension/__tests__/fallback-reason.test.js`).
- `chrome-extension/lib/diagnostics-schema.js` — bundle validator.
- `e2e-extension/copy-diagnostics.spec.ts`,
  `e2e-extension/copy-diagnostics-clipboard.spec.ts`,
  `e2e-extension/csp-blocked-overlay.spec.ts`,
  `e2e-extension/version-mismatch-overlay.spec.ts` — end-to-end
  contract tests for the banner and bundle.
