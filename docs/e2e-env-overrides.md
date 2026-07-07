# E2E Test Environment Overrides

This document lists the environment variables and runtime overrides available to
Playwright / Vitest suites so CI and local runs share consistent timing.

## `YJS_SNAPSHOT_DEBOUNCE_MS` (and friends)

The Yjs provider debounces `ydoc_state` upserts so rapid edits don't hammer the
database. The rename-race tests need to tune this so the debounce window is
predictable across machines. Resolution order (highest priority first):

| Source | Scope | Example |
| --- | --- | --- |
| `localStorage["syrin:yjs-snapshot-debounce-ms"]` | Per-page (Playwright injects via `addInitScript`) | `page.addInitScript(() => localStorage.setItem("syrin:yjs-snapshot-debounce-ms","300"))` |
| `import.meta.env.VITE_YJS_SNAPSHOT_DEBOUNCE_MS` | Browser build (Vite) | `.env.test` → `VITE_YJS_SNAPSHOT_DEBOUNCE_MS=400` |
| `process.env.YJS_SNAPSHOT_DEBOUNCE_MS` | Vitest / Node | `YJS_SNAPSHOT_DEBOUNCE_MS=200 bunx vitest run` |
| built-in default | — | **800 ms** |

Implementation: `src/lib/yjs/provider.ts` → `getSnapshotDebounceMs()`.

### Recommended values

| Context | Value | Why |
| --- | --- | --- |
| CI (GitHub Actions) | `400` | Faster suite while still exercising the debounce path |
| Local Playwright | `300` | Snappy manual reruns |
| Rename-race stress test | randomized `100–800` | Fuzz the resurrection window |
| Production default | `800` | Balances DB writes vs. crash recovery |

### Setting it in Playwright specs

```ts
const page = await context.newPage();
await page.addInitScript((ms) => {
  localStorage.setItem("syrin:yjs-snapshot-debounce-ms", String(ms));
}, 300);
```

Helper: `newPageWithDebounce(context, ms)` in `e2e/note-rename-yjs-race.spec.ts`.

## Related overrides

- `syrin:yjs-snapshot-debounce-ms` also drives the finalize/deletion-confirm
  polling window in `src/lib/rename.ts` (`waitForSlugDeletionConfirmed`).
- The `old-slug-cleanup-status` edge function logs `dbMs`/`totalMs` metrics —
  grep CI logs for `[cleanup-status]` when a resurrection is suspected.

## Rename stress + multi-tab observer overrides

| Variable | Default (local) | Default (CI) | Purpose |
| --- | --- | --- | --- |
| `STRESS_RENAME_SEED` | random `Date.now() ^ Math.random()` (attached to report as `stress-seed.json`) | same | Deterministic replay of the randomized debounce timeline. Accepts hex (`0x…`) or decimal. |
| `STRESS_RENAME_ITERATIONS` | `3` | `8` | Iteration count for the "repeated randomized-debounce renames" spec. |
| `MULTI_TAB_OBSERVER_WINDOW_MS` | `6000` | `15000` | How long Tab B keeps polling `old-slug-cleanup-status` and asserting the old slug never resurrects. |

### Replaying a failed stress run

The stress spec attaches `stress-seed.json` (seed + iterations + CI flag) and
`stress-timings.json` (per-iteration `debounceMs`, `from`, `to`, `durationMs`,
`outcome`). Preferred invocation (documented alias):

```sh
bun run e2e:rerun-stress path/to/playwright-report
# equivalent:
bash scripts/rerun-stress-from-report.sh path/to/playwright-report
```

The script:

1. Locates the first `stress-seed*.json` under the given directory (defaults
   to `./playwright-report` then `./test-results`).
2. Extracts `seed`, `iterations`, and `ci` from that payload.
3. Exports `STRESS_RENAME_SEED`, `STRESS_RENAME_ITERATIONS`, and (when the
   report was produced under CI) `CI=1`.
4. Invokes `bunx playwright test e2e/note-rename-yjs-race.spec.ts -g "stress: …"`.

Extra Playwright flags are forwarded, e.g.:

```sh
bun run e2e:rerun-stress path/to/playwright-report -- --project=chromium --headed
```

**End-to-end (from a CI failure):** download the
`e2e-html-report-<browser>-run<N>-attempt<M>` artifact from the failing run,
unzip it, then run `bun run e2e:rerun-stress <unzipped-dir>`.

### Debugging which iteration failed

Each stress iteration logs `[rename-race][stress] iteration-timing { i, from, to, debounceMs, startedAt }`
before running and either `clean` or `LINGERING detected` after — grep the
attached console log for the iteration index. `stress-timings.json` has the
same data in structured form.

### Multi-tab observer DOM snapshots

The multi-tab observer captures a lightweight DOM snapshot of both tabs
(`url`, first 200 chars of `.cm-content`, whether `body.innerText` contains the
old slug) at every polling check. On failure they land in the
`multi-tab-observer-timeline.json` report attachment under `domA` / `domB`.

## PWA update tunables

`src/lib/pwa-update.ts` reads the following build-time Vite env vars. All
accept a positive integer number of milliseconds; invalid values fall back to
the default.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_PWA_VERSION_POLL_MS` | `60000` | Interval for `/version.json` polling (mismatch → toast). |
| `VITE_PWA_SW_POLL_MS` | `60000` | Interval for `ServiceWorkerRegistration.update()` polling. |
| `VITE_PWA_RELOAD_FALLBACK_MS` | `2500` | How long to wait for `controllerchange` after `updateSW(true)` before hard-reloading. |

### Recommended values

| Context | version poll | sw poll | reload fallback |
| --- | --- | --- | --- |
| Production | `60000` | `60000` | `2500` |
| Local dev PWA smoke test | `5000` | `5000` | `1500` |
| CI (Playwright PWA specs) | overridden per-spec via `__SNOTE_E2E_PWA_POLL_INTERVAL_MS__` (see `e2e/pwa-update-*.spec.ts`) — the env vars above are the fallback when the E2E hook is not set | | |

E2E specs bypass the env vars entirely by setting
`window.__SNOTE_E2E_PWA_INITIAL_POLL_MS__` and
`window.__SNOTE_E2E_PWA_POLL_INTERVAL_MS__` via `addInitScript`, so tuning the
env vars for CI is only useful for real (non-E2E) builds deployed to preview
environments.
