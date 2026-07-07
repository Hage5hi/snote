## 1. Fix persistent "New version available" toast on the published site

**Root cause (from `src/lib/pwa-update.ts`):**
- The version poller compares `/version.json` `buildId` against the tab's `__BUILD_ID__` and triggers the toast whenever they differ.
- Clicking Update calls `pendingReload()` → `updateSW(true)`. `updateSW(true)` only reloads if there is a *waiting* service worker to activate. When the toast was fired by the **version poller** (not by `onNeedRefresh`), there is often no waiting SW yet — the new SW may still be `installing`, blocked by a large precache, or the user may have SW disabled. Nothing reloads, the poller runs again a minute later, and the toast reappears — forever. This matches the reported "I clicked Update many times, nothing happens, banner keeps coming back."
- Even when a reload happens, if the browser serves cached `index.html` (e.g. via HTTP cache with no revalidation), the tab boots the old `__BUILD_ID__` again and the mismatch persists.

**Fix (surgical, `src/lib/pwa-update.ts` only):**
1. Make `pendingReload` robust:
   - If `registration.waiting` exists → post `SKIP_WAITING` and reload on the next `controllerchange` (with a hard fallback timeout).
   - Otherwise → immediately do a cache-busting hard reload: `window.location.replace(location.pathname + '?v=' + newBuildId)` (query param defeats HTTP cache for `index.html`).
2. Track the last-seen remote `buildId` from the poller. Pass it into `triggerToast` so the reload URL carries the exact target build.
3. Persist `pwa-update-accepted-build` in `sessionStorage` when the user clicks Update. On boot, if `CURRENT_BUILD_ID` still equals the previously-accepted target (meaning the reload failed to pick up the new bundle), skip re-showing the toast for that build to break the loop and surface a one-time console warning instead.
4. Suppress duplicate toasts: if a toast with `TOAST_ID` is already visible, don't re-fire it every poll (sonner dedupes by id, but we should also early-return so the reload URL isn't overwritten).
5. Add lightweight console logs (`[pwa-update] mismatch current=… remote=…`, `[pwa-update] reload strategy=waiting|hard`) so future regressions are diagnosable from DevTools.

No changes to caches/localStorage/IndexedDB — user data stays untouched.

## 2. Playwright test: right-click Home opens new tab to `/`

New file `e2e/topbar-home-right-click.spec.ts`:
- Seed a note via existing `e2e/helpers/seed-note.ts` and navigate to `/<slug>`.
- Listen for `context.on('page', …)` to capture popups.
- Right-click the `ArrowLeft` link (`getByRole('link', { name: <brand.home i18n key resolved> })`) using `page.click({ button: 'right' })` — but since our handler uses `onContextMenu` + `window.open`, we dispatch it via `locator.dispatchEvent('contextmenu')` for cross-browser reliability, then await the `page` event.
- Assert the new page's URL ends with `/` and the original tab's URL is unchanged.

## 3. Documented CLI to replay a failing stress run from HTML report

The script already exists at `scripts/rerun-stress-from-report.sh`. Gaps to close:
- Add an npm script alias in `package.json`: `"e2e:rerun-stress": "bash scripts/rerun-stress-from-report.sh"` so the documented invocation is stable.
- Extend `docs/e2e-env-overrides.md` with a **Replaying a failed stress run** section documenting:
  - `bun run e2e:rerun-stress [report-dir]`
  - Which attachments it reads (`stress-seed*.json`), which env vars it exports (`STRESS_RENAME_SEED`, `STRESS_RENAME_ITERATIONS`, `CI`), and how to pass extra Playwright flags (`--project=chromium`, `--headed`).
  - Example end-to-end: download the CI `e2e-html-report-chromium-*` artifact, unzip, run the command.

## 4. CI: fail fast when replay attachments are missing; upload as artifacts

Update `.github/workflows/e2e.yml` in the existing `e2e` job:
- New step `Verify stress replay attachments` after "Run full e2e suite", `if: always()`:
  - Runs a small inline `node` check that scans `playwright-report/` and `test-results/` for at least one `stress-seed*.json` **and** one `stress-timings.json` when the stress spec ran (detect by grepping `e2e-results.json` for `note-rename-yjs-race`).
  - If the stress spec ran but attachments are missing → `exit 1` with a clear message so a broken instrumentation change (someone removing the `testInfo.attach` calls) fails CI immediately instead of silently regressing debuggability.
- New upload step `Upload stress replay attachments`, `if: always()`, `if-no-files-found: warn`:
  - Name: `stress-replay-${{ matrix.browser }}-run${{ github.run_number }}-attempt${{ github.run_attempt }}`
  - Paths: `playwright-report/**/stress-seed*.json`, `playwright-report/**/stress-timings.json`, `test-results/**/stress-seed*.json`, `test-results/**/stress-timings.json`.
- Add a one-line link to this artifact in the existing "Publish E2E timing and artifact summary" job-summary step (or a small new summary step) so reviewers can jump straight to it.

### Technical notes

- All PWA changes stay inside `src/lib/pwa-update.ts`; no service-worker manifest or Workbox config edits — the SW pipeline is already correct, only the client-side activation path is fragile.
- The new Playwright spec follows existing patterns in `e2e/note-rename-multi-tab-observer.spec.ts` for popup handling and reuses `e2e/helpers/seed-note.ts` (no new helpers).
- The CI verification step is pure `node -e` — no new dev dependency.
