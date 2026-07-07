## Goal
Make rename definitive: after `/old` is renamed to `/new`, `/old` must not keep showing the old content and must not be recreated by pending Yjs, IndexedDB, snapshots, beacons, or delayed effects.

## Root cause to address
The current fix mostly blocks late backend upserts, but the old slug can still appear unchanged because the browser keeps a local Yjs/IndexedDB document under `note:<oldSlug>`. When visiting `/old` again, `IndexeddbPersistence` can hydrate that cached content before/without a real database row, and provider connect can also auto-create an empty row for missing slugs. This makes the old slug look alive even after deletion.

## Plan
1. **Add a canonical rename cleanup API**
   - Create a small helper that, for an old slug, marks it abandoned, cancels active provider writes, destroys/release-removes the old cached Y.Doc, clears `y-indexeddb` data for `note:<oldSlug>`, removes any prefetched `sessionStorage` snapshot, and optionally clears local disaster-recovery snapshots for that slug.
   - Keep this helper focused on rename cleanup only.

2. **Strengthen provider/database guards**
   - Update `SupabaseYjsProvider.connect()` so an abandoned slug never auto-creates a row when `rowExists === false`.
   - Make all write paths (`scheduleSnapshot`, `saveSnapshot`, `flushBeacon`, reconnect flush) consistently no-op for abandoned/destroyed providers.
   - Add a doc-cache operation that can immediately evict/destroy a specific slug instead of only releasing it for 30 seconds.

3. **Fix the UI rename sequence**
   - In `RenameDialog`, after `prepareRename` and before/around navigation, run old-slug local cleanup so the current tab cannot rehydrate `/old` from IndexedDB later.
   - Keep the current navigation to `/new`, finalize delete, then re-check deletion with the retry toast behavior.
   - Ensure cleanup failures do not block rename, but they should be logged for diagnostics.

4. **Make deletion verification stricter**
   - Re-check the old slug row after the debounce window and after local cleanup.
   - If it still exists, show the existing warning toast; otherwise show success.

5. **Regression tests**
   - Add/adjust unit tests for:
     - abandoned slug connect does not create an empty row,
     - old-slug cached doc is evicted/destroyed during rename cleanup,
     - pending snapshot timers do not write after cleanup.
   - Add/adjust the API-level rename race test to simulate local cache/old doc resurrection and verify no `old-slug` upsert happens.
   - Enhance the Playwright rename test to revisit `/oldSlug` after rename and debounce, verifying the UI/database no longer show old content.

## Verification
- Run the targeted Vitest files for rename/provider/doc-cache behavior.
- Run the targeted note-rename Playwright spec if browser dependencies are available; otherwise rely on the API-level test and existing CI setup.
- Manually inspect the changed paths for no extra scope creep.