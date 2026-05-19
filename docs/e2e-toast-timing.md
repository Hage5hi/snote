# E2E toast timing thresholds

The Playwright suite for toast lifecycle assertions
(`expectToastLifecycle` in `e2e/helpers/toast.ts`) is parameterized so the
same tests run reliably on fast local dev machines and slower CI runners.

## Environment variables

| Variable                       | Default (local) | Default (CI)\* | Purpose                                                                 |
| ------------------------------ | --------------- | -------------- | ----------------------------------------------------------------------- |
| `E2E_TOAST_TIMEOUT_MS`         | `5000`          | `8000`         | Max time to wait for a toast to first become visible.                   |
| `E2E_TOAST_DISMISS_TIMEOUT_MS` | `8000`          | `12000`        | Max time to wait for a toast to auto-dismiss (catches lingering toasts).|
| `E2E_TOAST_MIN_VISIBLE_MS`     | `200`           | `250`          | Minimum dwell time before re-asserting visibility (catches flicker).    |

\* CI runs apply a 2× multiplier internally (`CI_MULT`) on top of any value
passed in, and `.github/workflows/ci.yml` also pre-sets the variables. The
"CI default" column is the **effective** value after both layers.

## Local overrides

To loosen thresholds on a slow machine, prefix the test command:

```bash
E2E_TOAST_DISMISS_TIMEOUT_MS=15000 bun run test:e2e
```

To tighten them while debugging a regression:

```bash
E2E_TOAST_TIMEOUT_MS=2000 E2E_TOAST_MIN_VISIBLE_MS=50 bun run test:e2e
```

## CI defaults

CI pins the values in `.github/workflows/ci.yml` under the `e2e` job:

```yaml
env:
  E2E_TOAST_TIMEOUT_MS: "8000"
  E2E_TOAST_DISMISS_TIMEOUT_MS: "12000"
  E2E_TOAST_MIN_VISIBLE_MS: "250"
```

Bump these (rather than per-test timeouts) when a runner upgrade or
heavier matrix causes flake.

## Regression test

`e2e/i18n-toast-regression.spec.ts` injects a synthetic toast that never
dismisses and asserts `expectToastLifecycle` correctly fails. If someone
weakens the helper, this test flips to failing and surfaces the regression
before it reaches real toast sites (Lock, Share, Rename).
