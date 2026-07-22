# Security findings — containment status

This document records the current security disposition. It supersedes the old
scan triage that described anonymous note access and deletion as false
positives. Slugs are locators, not authorization credentials; the capability
backend and atomic policy cutover remain required follow-up work.

## 1. Legacy note metadata and crawler previews — contained

`note-meta` is a generic `410 no-store` tombstone. It does not parse a token,
initialize a database client, or return content or a locator. The Cloudflare
Worker returns generic, non-indexable, `no-store` HTML for crawler requests to
both legacy note locators and `/s/*` before consulting metadata or Cache API.

Deployment order matters: deploy the generic Worker, purge all old note/share
HTML and `note-meta` caches, verify cache misses across every public alias, and
only then deploy the `note-meta` tombstone. Rollback must retain generic
containment rather than restoring content-bearing previews.

## 2. Admin authentication and cleanup — contained

Only `admin-session` accepts an admin passphrase. Login retains a bounded legacy
compatibility contract: any non-empty value up to 1,024 JavaScript code units
may be checked against an existing hash. Newly rotated passphrases alone enforce
the 12–72 UTF-8-byte bcrypt policy. The endpoint reserves a serialized SQL
admission lease and consumes failed attempts atomically. The client receives a
short random opaque session bound to a keyed HMAC of the gateway-verified client
address. Ambiguous or untrusted forwarding headers, database errors, and
retention-RPC errors fail closed with `503`.

`admin-list`, `admin-delete`, and `admin-rotate` accept only the opaque session.
Rotation atomically consumes the caller, updates the bcrypt hash and credential
epoch, and revokes every outstanding session. The old destructive `cleanup`
endpoint is a generic `410 no-store` tombstone because legacy clients can forge
every note field that its deletion predicate used.

`admin_security_prune()` deletes expired session hashes and limiter rows whose
failure window is older than seven days and whose lock/lease has expired. It is
service-role-only, runs on each admin-session request, and must also be scheduled
as a monitored daily retention job so idle deployments do not retain stale
keyed hashes.

## 3. Share tokens and legacy share paths — partially contained

`note_shares` remains RLS default-deny for `anon` and `authenticated`; access is
through service-role Edge functions. `share-view` never returns the underlying
slug, marks every JSON response `no-store`, and returns a generic `503` without
logging raw errors. `share-rename` is retired as a `410 no-store` tombstone.

Legacy `/s/:token` URLs still place a bearer-like token in the path. Platform
request logs and traces are disabled in the committed Wrangler configuration,
all other raw-path pipelines must be disabled or redacted at rollout, and the
Worker emits only generic crawler content. Moving share capabilities to URL
fragments and Authorization headers is deferred to the capability client/API
PRs and is not claimed complete here.

## 4. Public `notes` policies — real issue, cutover pending

The legacy schema still allows anonymous SELECT, INSERT, and UPDATE because the
current client reads and persists directly by slug. These `true` policies are a
confirmed authorization vulnerability, not an intentional security boundary.
Immediate containment revokes public DELETE and tombstones server cleanup, but
removing the remaining privileges before capability APIs and a dual-mode client
exist would destroy product availability and strand existing notes.

The required end state is the planned atomic cutover: immutable note IDs,
owner/edit/view capability hashes, narrow APIs/RPCs, private Realtime channels,
and no anonymous direct-table access. Legacy notes become exact-match read-only
and can be duplicated securely; they must not silently acquire an owner.

## 5. Public Realtime and persistence — real issue, cutover pending

The forged `slug-abandoned` control event has been removed and accepted event
types and payload sizes are bounded. A durable per-locator encryption pin now
fails closed before acquiring a Y.Doc, provider, IndexedDB persistence, editor,
preview, or disaster-snapshot path when a previously encrypted note is later
reported as plaintext or missing. Pin changes close already-mounted workspaces,
and every provider content path rechecks the database mode, active key mode,
and pin immediately before Realtime, snapshot, beacon, or keepalive output.

This is containment, not a replacement authorization boundary. A legacy
direct-table write already in flight cannot be revoked after the browser has
sent it, local Yjs persistence for encrypted notes is not yet encrypted at
rest, and public channels plus snapshot last-writer-wins persistence remain
transitional risks. They require the private capability-scoped Realtime
channels, idempotent Yjs update log, encrypted outbox/local persistence, and
checkpoint compaction planned for the capability backend/client PRs.

## 6. RLS enabled with no permissive policy — expected for internal tables

Default-deny on `note_shares`, `admin_config`, `admin_auth_attempts`,
`admin_sessions`, and `admin_auth_state` is intentional. These tables are
service-role-only. Do not add permissive policies merely to silence a generic
scanner; verify grants, RPC execution rights, and Edge callers instead.

## 7. Toolchain security exception — verified

The otherwise deferred Vite major upgrade is intentionally included because
[GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)
affects every Vite release through `6.4.2`; there is no patched Vite 5 release,
and `6.4.3` is the first patched line compatible with the current plugins.
[GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)
affects Vitest versions below `3.2.6`, so Vitest and `@vitest/coverage-v8` are
pinned together at `3.2.6`. The exception is accepted only with a frozen Bun
install, lint, all three TypeScript project checks, unit/security contracts,
production build plus bundle gate, extension E2E, and a high-severity dependency
audit passing. It does not authorize any other framework major in this PR.

## Re-running a security scan

Treat findings about public SELECT/INSERT/UPDATE on `notes` and public Realtime
as open until the atomic capability cutover is deployed and verified. Findings
about anonymous DELETE, legacy cleanup, note metadata, share crawler previews,
or passphrase reuse should be checked against the containment tests and staging
rollout evidence, not dismissed from this document alone.
