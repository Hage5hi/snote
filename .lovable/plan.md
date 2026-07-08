## Goal
Fix the production update loop where users click **Update** but stay on the old build, the toast keeps returning, and note URLs get polluted with `?v=...`. Also simplify the toast so users do not see technical `Current / Pending / Transition` details.

## What I found
- The URL pollution comes from `src/lib/pwa-update.ts`: `hardReload()` appends `?v=<buildId>` to the current note URL before `window.location.replace()`.
- The repeated toast happens because the app intentionally keeps the toast visible until `/version.json` matches the running bundled `__BUILD_ID__`. If the service worker/cache path keeps serving the old app shell, the match never happens.
- The current fallback only reloads with a cache-busting query. That can preserve/compound URL parameters and still leave users stuck behind stale service-worker state.
- The toast currently renders internal build metadata that is useful for E2E/debugging but not appropriate for normal users.

## Plan
1. **Replace the hard reload fallback**
   - Remove the `?v=...` URL mutation entirely.
   - On Update, first try the waiting service worker activation path when available.
   - If that fails or no waiting worker exists, run a stronger recovery path:
     - unregister existing app service workers,
     - delete app cache storage entries,
     - reload the current clean URL with `window.location.replace(window.location.pathname + window.location.search + window.location.hash)` or `window.location.reload()` without adding any new query parameter.
   - Preserve the note slug/path exactly; do not add cache-busting parameters to user-facing URLs.

2. **Tighten service worker update configuration**
   - Update the PWA config to make the generated worker claim clients and skip waiting consistently where appropriate for this prompt-driven update flow.
   - Keep existing preview/dev safety intact: no service worker in Lovable preview/dev contexts.
   - Keep `/version.json`, `/sw.js`, and Workbox files no-cache/no-store as they already are.

3. **Make update listeners safer**
   - Avoid accumulating event listeners/timers if `registerAppUpdater()` is ever initialized more than once in a tab.
   - Store cleanup callbacks for `visibilitychange`, `focus`, storage, and language-change listeners.
   - This directly addresses “toast keeps reappearing” risks caused by duplicated pollers/listeners.

4. **Simplify the update toast copy**
   - Remove visible `Current`, `Pending`, and `Transition` rows.
   - Keep hidden/data attributes only if needed for tests/debug state.
   - Add a short fallback sentence, e.g.:
     - English: “If updating still fails, clear this site’s data/cookies to force the newest version. This removes local web data on this device.”
     - Vietnamese equivalent for the Vietnamese locale.
   - Keep the primary message short: update reloads the app and notes/history should remain.

5. **Update tests to lock the fix**
   - Adjust unit/E2E tests that currently expect `Current/Pending` text.
   - Add/modify tests to assert:
     - clicking Update does **not** append `?v=` to note URLs,
     - repeated Update clicks trigger only one reload attempt,
     - stale-worker fallback calls service-worker/cache cleanup before reload,
     - toast no longer exposes `Current / Pending / Transition`,
     - user-facing fallback cleanup guidance is visible.

6. **Verify**
   - Run the focused PWA unit tests and focused PWA E2E specs related to update toast/reload behavior.
   - Confirm the live UI no longer shows technical metadata and preserves the current note URL after Update.