# Capability client and durable sync

This client is the dual-mode bridge between legacy slug notes and capability-managed notes. A slug is only a locator. Authorization is carried in the URL fragment, which browsers do not send to the server:

- owner: `/<slug>#owner=<43-character token>`
- editor: `/<slug>#edit=<43-character token>`
- viewer: `/s#view=<43-character token>`

The SPA parses those fragments and opens `note-session` only when
`VITE_CAPABILITY_ROUTES_ENABLED` is exactly `"true"`. That canary covers
NotePage owner/edit routes and SharePage `/s#view`. Missing, empty, or any
other value keeps both pages `legacyOnly`. The same flag fail-closes
`createCapabilityApi()`: `note-session`, `note-sync`, and `note-manage`
throw `capability API unavailable` without fetching, and default Auth
minting stays off. Production builds attest `capabilityRoutesEnabled: false`.

An optional encryption secret is a separate `key` fragment field. Capability tokens are exchanged for a short-lived `NoteSession` and are sent to Edge APIs only as an exact `Authorization: Bearer` header. They are never placed in a request path, query, JSON body, recent-note entry, telemetry event, or log.

## Durable update path

Every local Yjs update is encrypted when the note is locked, hashed over the exact transported bytes, and inserted into the IndexedDB outbox before Realtime broadcast or HTTP sync. `note-sync` assigns a sequence and acknowledges the update ID idempotently. The client removes only acknowledged IDs, so navigation, offline use, reopening, duplicated delivery, and reversed delivery cannot discard an edit. An edit-capable peer also persists a validated broadcast under the same hash; a view-only peer applies broadcasts without accumulating an outbox it cannot acknowledge.

After 200 updates beyond the latest checkpoint, an editor encodes the merged Yjs state and submits a checkpoint with `throughSequence`, encryption-version CAS, and checkpoint-version CAS. A concurrent winner causes a session refresh rather than a stale retry loop. Checkpoints do not delete the append-only audit log.

## Local encryption boundary

Locked notes do not mount `y-indexeddb`. Their capability outbox, checkpoints, updates, and disaster snapshots contain ciphertext only. Enabling encryption converts existing recovery snapshots atomically and deletes the old plaintext Yjs database; failure clears recovery history rather than leaving plaintext behind. Explicit unlock converts the recovery history while the key is still available.

The Chrome extension stores only edit capabilities in `chrome.storage.local`. It never accepts or syncs an owner capability. Legacy slug URLs remain available during the dual-mode rollout; capability-managed notes are opened through the session API and never through direct table access.

## Operational constraints

- Keep the capability backend migration and all four Edge APIs deployed before enabling capability note creation.
- Configure private Realtime authorization and the JWT/HMAC secrets described in `docs/capability-backend.md`.
- Run the production aggregate payload audit before deployment. Oversized notes are quarantined read-only rather than truncated.
- A cutover or rollback must preserve the IndexedDB outbox. Rollback defaults to API read-only and must not restore anonymous table writes.
