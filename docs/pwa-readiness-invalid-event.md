# `snote:pwa-readiness-invalid` — QA debug guide

The PWA update layer exposes a shared readiness state on
`window.__SNOTE_PWA_UPDATE_STATE__`. `<PwaUpdateDebugPanel>` (DEV builds
only) validates that object every 500 ms against the schema in
`src/lib/pwa-update-readiness.ts`. If validation fails, the panel unmounts
and dispatches a `CustomEvent` so QA can debug why.

## Event

- **Name:** `snote:pwa-readiness-invalid`
- **Target:** `window`
- **Fires when:** the value on `window.__SNOTE_PWA_UPDATE_STATE__` is not
  `undefined`/`null` but does not satisfy `validatePwaReadinessState`.
- **Fires from:** `<PwaUpdateDebugPanel>` (DEV) via `emitPwaReadinessInvalidEvent`.
  Callers can invoke `emitPwaReadinessInvalidEvent(anyValue)` directly too.

## `detail` payload

```ts
type PwaReadinessInvalidReason = {
  field: string;    // "reloadStrategy" | "<root>" | ...
  path: string;     // alias of `field` (dot-path style for QA tooling)
  reason: string;   // human-readable, e.g. "must be 'waiting-sw'|'hard'|null"
  received: string; // typeof / stringified value that failed
};
```

Only the **first** failing field is reported per emission (fail-fast).

## Field catalog

| `field`              | Expected                                      |
| -------------------- | --------------------------------------------- |
| `<root>`             | non-null plain object (not array/primitive)   |
| `currentBuildId`     | non-empty string                              |
| `pendingBuildId`     | `string \| null`                              |
| `updateAvailable`    | `boolean`                                     |
| `updateInProgress`   | `boolean`                                     |
| `reloadAttemptCount` | non-negative integer                          |
| `reloadStrategy`     | `"waiting-sw" \| "hard" \| null`              |
| `lastRemoteBuildId`  | `string \| null \| undefined` (optional)      |
| `lastAcceptedAt`     | finite `number \| null \| undefined` (opt.)   |

## Quick console snippet for QA

Paste in DevTools to log every rejection in real time:

```js
window.addEventListener("snote:pwa-readiness-invalid", (e) => {
  console.warn("[readiness:invalid]", e.detail);
});
```

To manually inspect the current state and its verdict:

```js
window.__SNOTE_PWA_UPDATE_STATE__
window.__SNOTE_PWA_READINESS_VALIDATE__?.(window.__SNOTE_PWA_UPDATE_STATE__)
window.__SNOTE_PWA_READINESS_EXPLAIN__?.(window.__SNOTE_PWA_UPDATE_STATE__)
```

`__SNOTE_PWA_READINESS_VALIDATE__` / `__SNOTE_PWA_READINESS_EXPLAIN__` are
installed by the debug panel in DEV (`exposeReadinessValidatorForE2E`) — they
are not available in production builds.

## Typed consumer guide

Prefer the exported constant + type alias over string/shape duplication:

```ts
import {
  PWA_READINESS_INVALID_EVENT,
  type PwaReadinessInvalidEventDetail,
} from "@/lib/pwa-update-readiness";

function onInvalid(e: CustomEvent<PwaReadinessInvalidEventDetail>) {
  const { field, path, reason, received } = e.detail;
  console.warn(`[readiness:invalid] ${path} — ${reason} (received=${received})`);
}

// WindowEventMap is augmented, so `e` is fully typed:
window.addEventListener(PWA_READINESS_INVALID_EVENT, onInvalid);
// later:
window.removeEventListener(PWA_READINESS_INVALID_EVENT, onInvalid);
```

`field` and `path` are always equal; `path` exists as a stable alias for
QA tooling that groups reasons by dot-path.

## Related tests

- Unit: `src/lib/__tests__/pwa-update-readiness.test.ts`
- Integration: `src/lib/__tests__/pwa-readiness-invalid-event.test.ts`,
  `src/lib/__tests__/pwa-readiness-invalid-edge-fields.test.ts`,
  `src/lib/__tests__/pwa-readiness-invalid-event-batch.test.ts`
- E2E: `e2e/pwa-readiness-invalid-event.spec.ts`,
  `e2e/pwa-readiness-invalid-event-order.spec.ts`,
  `e2e/pwa-readiness-invalid-event-not-emitted-when-valid.spec.ts`

