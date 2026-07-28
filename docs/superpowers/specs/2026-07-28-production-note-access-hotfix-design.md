# Production Note Access Hotfix Design

## Incident

The production build generated at 2026-07-28 04:06 UTC contains the
capability-only client introduced by merge commit `947059d7`. Its two required
Edge Functions are not deployed: both `legacy-note-open` and `note-session`
return `404 Requested function was not found`. The legacy `notes` REST endpoint
still returns `200` for an exact synthetic lookup.

This rollout-order mismatch makes existing notes render the generic legacy
unavailable state and makes new-note creation fail before navigation.

## Goal

Restore opening, editing, and creating notes against the backend contract that
is actually deployed, without mutating note data, schema, policies, functions,
DNS, or Cloudflare configuration.

## Approaches considered

1. **Restore the legacy client path only (selected).** Route normal and split
   note views to the existing default `NotePage`, restore Home's direct exact
   availability query and navigation, and restore RawView's direct exact read.
   This is the smallest forward hotfix and preserves unrelated reliability,
   accessibility, dependency, and CI improvements.
2. **Revert all changes after `4b19cbc`.** This would restore the old client but
   discard hundreds of unrelated validated changes and create a much larger
   regression surface.
3. **Deploy the capability backend during the outage.** This requires ordered
   migrations, secrets, backup/restore evidence, Edge Function deployment, and
   a soak. It is unsafe as an emergency repair and remains a separate rollout.

## Runtime design

- `App.tsx` and `SplitView.tsx` lazy-load the default `NotePage` in explicit
  `legacyOnly` mode. Capability-shaped fragments cannot activate the missing
  backend from ordinary or split routes; the component uses
  `SupabaseYjsProvider` and the currently deployed `notes` table.
- `Home.tsx` lazily loads the existing Supabase client and checks one exact
  slug without preloading the Supabase vendor on the initial route. Submit and
  Random note navigate directly to `/<slug>`; the editor creates durable state
  through its established legacy provider when the user edits. Availability is
  informational, so a failed optional lookup cannot block direct navigation.
  Home warms only editor modules on hover and does not prefetch or cache note
  content.
- `RawView.tsx` reads one exact slug directly from `notes`, preserving the
  current fragment-only encryption-key behavior. Each load owns a generation,
  clears stale UI state, and checks ownership after every asynchronous crypto
  phase so a slow old route cannot reveal or overwrite content under a new URL.
  Rendered state is keyed to pathname, search, and hash, and async ownership is
  also checked against the live browser URL to cover Router transitions. Legacy
  `?key=` migration preserves React Router history metadata.
- `SupabaseYjsProvider` flushes pending plaintext and encrypted edits before an
  ordinary SPA teardown, while abandoned slugs remain write-blocked. Snapshot
  writes are serialized per slug across provider remounts and versioned so an
  older encrypted request cannot finish last and overwrite the final teardown
  snapshot. Its document listener is installed synchronously at construction,
  before encrypted snapshot decryption can yield to an already-mounted editor.
- Legacy lock/unlock transitions are temporarily hidden in `legacyOnly` mode.
  The deployed table has no conditional/versioned write primitive, so allowing
  a transition during an in-flight snapshot could corrupt the encryption mode.
  Existing encrypted notes can still be unlocked for use; changing their
  durable encryption mode remains reserved for the capability backend rollout.
- Legacy share UI receives an explicit key-only current-note URL. Owner/edit
  capability fragments can remain in the address bar for future recovery, but
  cannot enter the displayed URL, clipboard, QR code, or a generated read-only
  share URL while the capability backend is offline. Read-only URLs append the
  separately parsed and encoded encryption secret, never the raw fragment.
- Remaining capability code, migrations, and Edge Functions stay dormant and
  are not selected by production's ordinary note routes until the backend
  rollout is completed and explicitly re-enabled in a later release. The now
  unreachable Home-only create-recovery helper and its isolated test are
  removed instead of hidden from the unused-code gate.
- The critical accessibility smoke uses a valid mocked legacy snapshot so it
  exercises the real note UI. The CodeMirror textbox has an accessible name,
  and the synced status uses the foreground token that meets contrast gates.

## Safety boundaries

- No production data write is used to diagnose or validate the hotfix.
- No migration, RLS change, Edge Function deployment, cache purge, or DNS
  change is part of this repair.
- The hotfix does not claim that the legacy data model is the desired final
  security architecture. It restores the already-deployed server contract
  while the capability rollout returns to staging.
- PR #10 remains an unmerged draft and is not part of the emergency deploy.

## Verification and rollout

Add a source contract test that fails while ordinary note entry points depend
on the missing functions. Add runtime tests for Home's exact lookup/navigation,
RawView route ownership, pre-connect encrypted edits, cross-remount snapshot
ordering, stale live-URL metadata, legacy encryption/share containment,
plaintext/encrypted edit teardown, editor labelling, and sync-status contrast.
Run them red, apply the minimal client changes, then run focused tests, the
exact Chromium PR smoke without retries, lint, typechecks, the full unit and
coverage suites, dependency/unused-code/i18n gates, and production build.
After an independent diff review and green GitHub checks, merge the hotfix PR
to `main`, wait for Lovable's build ID to change, and verify the production
ordinary-note execution no longer requests either missing function.

Production functional validation uses a synthetic slug only; user note names
and content must not be copied into logs or evidence.
