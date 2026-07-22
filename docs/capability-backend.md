# Capability backend

This is the additive backend phase for accountless secure notes. A slug is a
locator. A 32-byte capability is the authority. Existing notes stay in legacy
mode and never receive an owner capability automatically.

## Threat model and invariants

- Raw owner, edit, and view capabilities are returned only at secure-note
  creation or rotation. They are never stored in Postgres.
- `note_capabilities.token_hash` stores a domain-separated HMAC-SHA-256 made
  with `CAPABILITY_HMAC_SECRET`. A database-only leak cannot be used to mint or
  verify candidate capabilities offline without that separate secret.
- Capability requests put the token only in `Authorization: Bearer <token>`.
  New endpoints do not read tokens from a path, query string, or JSON body and
  do not log request data.
- The temporary `x-legacy-share` header is solely for old `/s/:token` links.
  It is not accepted as a new capability and is removed by the PR5 cutover.
- During the additive phase, legacy share creation is serialized through
  `legacy_share_rotate`. The atomic cutover tombstones that Edge endpoint and
  revokes the RPC from `service_role`, so legacy state is read-only afterward.
- `owner` can manage and edit, `edit` can sync, and `view` can only read.
- Realtime JWTs expire after five minutes. Their `sub`, `note_id`, scope, and
  generation are checked against an active capability by RLS on
  `realtime.messages`; channels use the private topic `note:<noteId>`.
- `note_updates` and `note_checkpoints` reject in-place update/direct delete.
  They are removed only when an authorized database deletion removes the whole
  parent note. A repeated update with the same SHA-256 `updateId` is idempotent
  and resolves to its original sequence.
- Encryption transitions require an owner capability, the expected encryption
  version, and a checkpoint through the current update sequence in one database
  transaction. No client may directly toggle the encrypted state.
- The migration publishes its security-definer functions, revocations, and
  grants in one transaction; a partially applied privilege boundary is never
  committed.

## Public HTTP contract

All responses carry `Cache-Control: no-store` and `CDN-Cache-Control: no-store`.
After the atomic cutover, legacy note content is available only through the
exact-match `legacy-note-open` Edge Function. Browser roles have no direct
table grants. See [the cutover runbook](security/atomic-capability-cutover.md)
for the mandatory 48-hour soak, migration order, compatibility deadline, and
read-only rollback procedure.
Malformed credentials return a generic `401`; storage/configuration failures
return `503` without including database error text.

### `note-session`

`POST { "action": "create", "slug": "..." }` creates a secure note when no
Authorization header is present. The `201` response contains `{ session,
capabilities: { owner, edit, view } }`; this is the only time all three raw
capabilities are returned.

`POST { "action": "import-legacy", ...initialCheckpoint }` is the cutover-only
duplicate path. It validates/encrypts on the client first, then atomically
inserts the note, capability hashes, and initial checkpoint in one database
transaction. The client persists a fresh owner candidate before sending it as
the Bearer credential; retrying the same owner + checkpoint recovers a commit
whose response was lost instead of leaving an unowned slug.

Otherwise, send `Authorization: Bearer <capability>` and optionally
`{ "afterSequence": 42 }`. The response contains a `NoteSession`:

```ts
type NoteSession = {
  noteId: string
  slug: string
  scope: "owner" | "edit" | "view"
  realtimeToken: string
  realtimeExpiresAt: string
  realtimeTopic: `note:${string}`
  syncStatus: "active" | "read_only_quarantine"
  currentSequence: number
  payloadLimitBytes: number
  checkpointSequence: number
  checkpointVersion: number | null
  checkpointPayload: string | null
  checkpointEncryptionVersion: number | null
  missingUpdates: Array<{
    updateId: string
    payload: string
    sequence: number
    encryptionVersion: number
  }>
  encryption: {
    enabled: boolean
    version: number
    salt: string | null
    check: string | null
    iterations: number
  }
}
```

Database payloads in `NoteSession` use unwrapped standard base64. Write requests
use canonical unpadded base64url so the server can reject alternate encodings.

### `note-sync`

Send a Bearer owner/edit capability and:

```json
{
  "updates": [{ "updateId": "sha256-hex", "payload": "base64url" }],
  "expectedEncryptionVersion": 0,
  "afterSequence": 42
}
```

The server verifies that every `updateId` is the SHA-256 of the exact payload,
validates the complete batch before the first write, inserts it atomically, and
returns `{ acknowledgements, session }`.
Calling it again with the same `{ updateId, payload }` is idempotent and returns
the same sequence. A view capability is rejected. A stale encryption version or
`read_only_quarantine` note cannot accept writes.

An owner/editor may also send an optional checkpoint
`{ checkpointId, payload, throughSequence, expectedCheckpointVersion }`.
Checkpoint creation uses checkpoint-version and encryption-version CAS;
`throughSequence` must advance beyond the latest checkpoint without exceeding
the durable update sequence.

### `note-manage`

All actions require an owner Bearer capability:

- `{ "action": "rename", "slug": "new-slug" }`
- `{ "action": "delete" }` (atomic parent delete; capabilities and opaque
  history are erased by foreign-key cascade)
- `{ "action": "rotate", "scope": "edit" | "view" }`
- `{ "action": "set-encryption", ... }` with expected version and a checkpoint

Rotation returns the new raw capability once. Owner rotation is intentionally
not exposed in this phase to avoid an unrecoverable accidental lockout.

### `share-view`

A view capability in the Bearer header receives the same `NoteSession` shape;
send `{ "afterSequence": 42 }` to page beyond the first 500 missing updates.
Owner/edit capabilities may also read. During dual-mode soak, an old share can
still use `x-legacy-share`; it only reads a non-capability-managed legacy row.

## Payload sizing and quarantine

Before staging enables the new endpoints, run:

```sql
select * from public.capability_payload_audit(1048576);
```

The result is aggregate-only: counts and maximum byte sizes, never content,
slug, token, or IP. Set `notes.payload_limit_bytes` above the largest valid
production payload while remaining below the verified Edge/gateway request
limit. Run `capability_quarantine_oversized()` after changing a limit. It marks
exceptions `read_only_quarantine`; it never truncates or deletes data.

## Migration and rollout order

1. Take the required staging backup/PITR checkpoint.
2. Add `CAPABILITY_HMAC_SECRET` and a Supabase-compatible
   `SUPABASE_JWT_SECRET` to Edge secrets. Each must contain at least 32 bytes.
3. Apply `20260722000000_capability_backend.sql` on staging.
4. Run the aggregate payload audit, choose the production limit, and quarantine
   exceptions.
5. Deploy `note-session`, `note-sync`, `note-manage`, and `share-view` with JWT
   gateway verification disabled; each function performs its own Bearer check.
6. Verify private-channel RLS for owner/edit/view and revoked generations.
7. Soak with synthetic capability notes before any client or table cutover.

## Rollback

Disable the four Edge functions first. Leave the additive tables and immutable
identifiers in place so updates and checkpoints remain recoverable. Put secure
notes into `read_only_quarantine`; do not re-enable public access to them and do
not drop append-only data. Legacy policies remain limited to
`capability_managed = false` until the separate PR5 transaction removes all
direct-table privileges.
