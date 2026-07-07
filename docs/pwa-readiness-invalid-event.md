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

## Production-safe reporter (sampled, env-gated)

`installPwaReadinessInvalidReporter` wires the event to any analytics/log
sink with a sample rate so real-world failures are trackable without spam.

**Default behavior: DISABLED.** The reporter is opt-in per-deployment via
env flags — calling `installPwaReadinessInvalidReporter()` without opts in
a build that hasn't set `VITE_PWA_READINESS_REPORTER_ENABLED` is a no-op
and returns a no-op unsubscribe. This keeps production clients silent
unless the deployer explicitly turns analytics on.

| Env var                                    | Purpose                                | Default |
| ------------------------------------------ | -------------------------------------- | ------- |
| `VITE_PWA_READINESS_REPORTER_ENABLED`      | `"true"` / `"1"` to enable reporter    | unset (disabled) |
| `VITE_PWA_READINESS_REPORTER_SAMPLE_RATE`  | float `0..1`, sampling rate            | `0.01` (1%) |

```ts
import { installPwaReadinessInvalidReporter } from "@/lib/pwa-update-readiness";

// Respects env gate (no-op unless VITE_PWA_READINESS_REPORTER_ENABLED=true):
const off = installPwaReadinessInvalidReporter({
  sink: (detail) => analytics.track("pwa_readiness_invalid", detail),
});

// Tests / forced usage bypasses the env gate:
installPwaReadinessInvalidReporter({ sampleRate: 1, sink, force: true });
```

The reporter validates each payload against
`PwaReadinessInvalidEventDetailSchema` before forwarding, and never lets a
throwing sink escape into app code.


## JSON Schema / typed schema for payload

`PwaReadinessInvalidEventDetailJsonSchema` (draft-07) and
`PwaReadinessInvalidEventDetailSchema.parse` / `.safeParse` are exported
from `@/lib/pwa-update-readiness` for runtime + test payload validation.

## Dedupe guarantee

The debug panel keys emissions by the raw readiness state (JSON hash) and
by the invalid signature, so an unchanged malformed state emits
`snote:pwa-readiness-invalid` **once**, not once per 500 ms poll tick.
Changing the state to a new invalid signature emits again.

## Related tests

- Unit: `src/lib/__tests__/pwa-update-readiness.test.ts`,
  `src/lib/__tests__/pwa-readiness-invalid-event-schema.test.ts`
- Integration: `src/lib/__tests__/pwa-readiness-invalid-event.test.ts`,
  `src/lib/__tests__/pwa-readiness-invalid-edge-fields.test.ts`,
  `src/lib/__tests__/pwa-readiness-invalid-event-batch.test.ts`
- E2E: `e2e/pwa-readiness-invalid-event.spec.ts`,
  `e2e/pwa-readiness-invalid-event-order.spec.ts`,
  `e2e/pwa-readiness-invalid-event-not-emitted-when-valid.spec.ts`,
  `e2e/pwa-readiness-invalid-single-emit-per-cycle.spec.ts`


