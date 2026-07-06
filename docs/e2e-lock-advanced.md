# E2E: Multi-tab, Stress & Remount Timing Lock Tests

Specs:
- `e2e/note-lock-multi-tab.spec.ts` — Tab A locks, Tab B cannot write until unlock.
- `e2e/note-lock-stress.spec.ts` — 12× rapid hash churn, then reload/decrypt.
- `e2e/note-lock-remount-timing.spec.ts` — asserts editor becomes non-editable
  within `MAX_EDITABLE_WINDOW_MS` (see spec) after lock is initiated.

## Run locally

Prereqs (one-time): `bun install && bunx playwright install`

```bash
# All three:
bunx playwright test \
  e2e/note-lock-multi-tab.spec.ts \
  e2e/note-lock-stress.spec.ts \
  e2e/note-lock-remount-timing.spec.ts

# Individually, headed:
bunx playwright test e2e/note-lock-multi-tab.spec.ts --headed
bunx playwright test e2e/note-lock-stress.spec.ts --headed
bunx playwright test e2e/note-lock-remount-timing.spec.ts --headed

# Cross-browser:
PLAYWRIGHT_PROJECT=firefox bunx playwright test e2e/note-lock-stress.spec.ts
PLAYWRIGHT_PROJECT=webkit  bunx playwright test e2e/note-lock-multi-tab.spec.ts

# Retries for flake triage:
bunx playwright test e2e/note-lock-remount-timing.spec.ts --retries=2
```

Seeding uses the anon key from `.env` (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`). Dev server is auto-started via `webServer`.

## Inspect traces / artifacts

Traces, videos, and screenshots are retained for these specs on **both success
and failure** (see `playwright.config.ts` `use.*` overrides for the lock
suites), so any run — flaky or clean — is debuggable without re-running.

```bash
# Open the HTML report (embeds screenshots + videos + traces):
bunx playwright show-report

# Raw artifacts:
ls test-results/
#   note-lock-remount-timing-*-chromium/
#     trace.zip     video.webm     test-*.png

bunx playwright show-trace test-results/<...>/trace.zip
```

CI uploads them per browser/run/attempt (see `.github/workflows/e2e.yml`).

## Remount timing diagnostics

When `note-lock-remount-timing.spec.ts` fails, the assertion message includes:
- observed elapsed time (ms),
- threshold (`MAX_EDITABLE_WINDOW_MS`),
- per-poll samples of `.cm-content[contenteditable='true']` count.

Attach `test-results/.../trace.zip` in a bug report — it contains the full
network + DOM timeline of the remount.
