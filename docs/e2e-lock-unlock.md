# E2E: Lock / Unlock Notes

Playwright spec: `e2e/note-lock-unlock.spec.ts`
Seed helper: `e2e/helpers/seed-note.ts`
Config: `playwright.config.ts` (retries=0 by default, video/screenshot/trace on failure)

## Run locally

Prereqs (one-time): `bun install && bunx playwright install chromium`

```bash
# Run just the lock/unlock spec
bunx playwright test e2e/note-lock-unlock.spec.ts

# Watch it run in a real browser
bunx playwright test e2e/note-lock-unlock.spec.ts --headed

# All e2e specs
bunx playwright test

# Cross-browser matrix (chromium/firefox/webkit)
PLAYWRIGHT_PROJECT=firefox bunx playwright test e2e/note-lock-unlock.spec.ts

# Retry flaky runs (override config default of 0)
bunx playwright test e2e/note-lock-unlock.spec.ts --retries=2
```

The suite reuses `bun run dev` via `webServer` in `playwright.config.ts`, so no
manual dev server is needed. Seeding uses the anon key from `.env`
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).

## Inspect failure artifacts

`playwright.config.ts` sets `trace/video: "retain-on-failure"` and
`screenshot: "only-on-failure"`. After a failing run:

```bash
# Open the HTML report (embeds screenshots + videos + traces)
bunx playwright show-report

# Raw artifacts live under test-results/
ls test-results/
#   <spec>-<test>-chromium/
#     test-failed-1.png     screenshot at failure
#     video.webm            full run video
#     trace.zip             time-travel trace

# Open a trace interactively
bunx playwright show-trace test-results/<...>/trace.zip
```

## What the spec covers

1. **Round-trip**: seeds a plaintext note, locks it via the UI, reloads
   (simulating close-and-reopen with the URL hash), unlocks, reloads again,
   and asserts the original text survives every transition.
2. **In-flight guard**: throttles the `PATCH /rest/v1/notes` upsert with
   `page.route()` and asserts the confirm button disappears (spinner state)
   before the reload, proving the user cannot re-submit edits between the
   state change and the reload.

Each test gets a unique slug (`e2e-lock-<ts>-<rand>`) so parallel runs and
CI reruns never collide, and the `afterEach` deletes the row.
