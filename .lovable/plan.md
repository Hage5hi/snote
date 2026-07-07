## Scope

Three items. #1 is large and touches many layers, so I'm laying it out before touching code.

### 1. Remove "Rename slug" and "Duplicate note" entirely

These features are woven through UI, libs, edge functions, tests, and i18n. Plan removes them in dependency order so the app never enters a half-broken state.

**UI (safe to delete outright)**
- `src/components/note/RenameDialog.tsx`
- `src/components/note/DuplicateDialog.tsx`
- `src/components/note/__tests__/RenameDialog.test.tsx`
- Prune Rename/Duplicate menu items, handlers, state, and shortcuts from:
  - `src/components/note/topbar/NoteMenu.tsx`
  - `src/components/note/topbar/Topbar.tsx`
  - `src/pages/NotePage.tsx` (dialog mounts, keyboard shortcut wiring)
  - `src/components/CommandPalette.tsx` / `CommandPaletteBody.tsx` (rename/duplicate commands, if present)
  - `src/components/ShortcutHelp.tsx` (rename/duplicate rows)

**Library code**
- Delete `src/lib/rename.ts` and `src/lib/rename-cleanup-status.ts`.
- `src/lib/recent-notes.ts` — drop `renamePinned` / `renameRecent` exports; keep the rest.
- `src/lib/share-tokens.ts` — drop `renameShareToken` export.
- `src/lib/yjs/provider.ts` + `src/lib/yjs/doc-cache.ts` — remove the rename-abandon path (`unabandonProviderForSlug`, abandoned-slug guards, prepare/finalize hooks). The doc cache/provider keep working; only rename-specific branches go.
- `src/lib/snapshots.ts` — remove rename-related snapshot cancellation only if it's rename-only; keep general snapshot APIs.

**Edge functions**
- Delete `supabase/functions/share-rename/` and `supabase/functions/old-slug-cleanup-status/` (rename-only surfaces).
- Leave `share-create`, `share-view`, `share-revoke`, `raw`, etc. untouched.

**i18n**
- Remove `rename.*` and `dup.*` keys from `src/i18n/index.ts` (all locales).
- Update `.lintrc-i18n-allowlist.json` if it references any removed keys.

**Tests**
- Delete rename/duplicate unit tests: `src/lib/__tests__/rename*.test.ts`, `src/components/note/__tests__/RenameDialog.test.tsx`.
- Delete rename E2E specs: `e2e/note-rename-*.spec.ts`, `e2e/helpers/rename-cleanup.ts`.
- Trim rename cases from shared specs: `e2e/i18n-dialogs.spec.ts`, `e2e/i18n-toast-regression.spec.ts`, `e2e/helpers/db-assert.ts`, `src/lib/yjs/__tests__/{provider,doc-cache}.test.ts`, `src/lib/__tests__/recent-notes.test.ts`.
- Leave unrelated `scripts/__tests__/*` (ci-sticky, i18n-allowlist) alone — their "rename"/"duplicate" matches are coincidental (renaming report files, duplicate-audit heuristics).

**Docs**
- Prune rename/duplicate references from `README.md`, `CLAUDE.md`, `docs/architecture.md`, `docs/known-issues.md`, `CHANGELOG.md` (add a removal entry).

**Verification loop**
1. `bunx tsgo -p tsconfig.app.json` — no dangling imports.
2. `bunx vitest run` — unit tests green after removals.
3. `bunx eslint .` — no unused-var warnings from stripped handlers.
4. Manual: load a note, confirm the Note menu no longer shows Rename/Duplicate and the app renders normally.

### 2. E2E for stalled SW registration

- New spec `e2e/pwa-update-sw-stall.spec.ts` that:
  - Uses `installPwaUpdateMock` with poll disabled (`initialPollMs: 10_000_000`) so `__SNOTE_PWA_UPDATE_STATE__.lastRemoteBuildId` never populates.
  - Calls `waitForPwaUpdaterReady(page, testInfo, 500)` inside `expect(...).rejects.toThrow(/version poller never populated/)`.
  - After the throw, reads `testInfo.attachments` and asserts one entry is `pwa-updater-not-ready.json` with `lastState`, `swState`, and `timeoutMs` fields.
- No production code changes needed — this only exercises the existing readiness gate.

### 3. Document the dev PWA debug panel + readiness gate in `e2e/README.md`

Add a new "Dev PWA debug panel" section covering:
- File: `src/components/dev/PwaUpdateDebugPanel.tsx`, mounted from `src/App.tsx`.
- Enabled only when `import.meta.env.DEV` is true (`bun run dev`); hidden in preview/prod builds.
- Reads `window.__SNOTE_PWA_UPDATE_STATE__` every 500ms, so the same values feed the toast, the polling summary, and the panel.
- Field reference: `current`, `pending`, `strategy` (`waiting-sw` | `hard` | `—`), `attempts`, `inProgress`.
- Note that the pwa updater short-circuits in Lovable preview, so the panel stays empty there.

And a "Readiness gate" section covering:
- `waitForPwaUpdaterReady(page, testInfo, timeoutMs=5000)` in `e2e/helpers/pwa-update-mock.ts`.
- What it waits for (`lastRemoteBuildId`), the default 5s timeout, and how to shorten it in stall tests.
- On timeout it attaches `pwa-updater-not-ready.json` (schema: `{ lastState, swState: { supported, hasRegistration, active, waiting, installing }, timeoutMs }`) and throws — matching item 2's assertion target.

---

## Non-goals / guardrails

- Do not touch unrelated schema-drift, ci-sticky, or i18n-allowlist scripts.
- Do not alter `src/integrations/supabase/{client,types}.ts` or `supabase/config.toml`.
- Keep the `notes.slug` column and all other schema untouched — removing the UI is enough; a DB migration is out of scope unless you ask.
- Recent-notes/pinned-notes storage keys stay backward compatible; only the rename-time mutation helpers are removed.

Reply "go" (or with edits) and I'll execute in the order above.
