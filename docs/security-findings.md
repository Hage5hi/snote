# Security findings — repository and rollout status

This document describes the state of the stacked implementation. It does not
claim that staging or production has been migrated. Local tests prove the code
contracts only; backup, deploy, cache purge, 48-hour soak, atomic cutover, and
post-cutover probes remain mandatory operational gates.

Slugs are locators, never authorization credentials. New notes use
owner/edit/view capabilities. Legacy notes are exact-match, read-only, and may
only be copied into a new capability-managed note.

## 1. Legacy metadata and crawler previews — implemented, deploy unverified

`note-meta` is a generic `410 no-store` tombstone. It does not parse a token,
initialize a database client, or return content or a locator. The Cloudflare
Worker returns generic, non-indexable, `no-store` HTML for crawler requests to
legacy note and share paths before consulting metadata or Cache API.

Production still requires the ordered rollout in
`docs/security/immediate-containment-rollout.md`: deploy the generic Worker,
purge old note/share HTML and metadata caches across every alias, verify cache
misses, then deploy the tombstone. Rollback must retain generic containment.

## 2. Admin authentication and cleanup — implemented, deploy unverified

Only `admin-session` accepts an admin passphrase. It reserves a serialized SQL
admission lease and consumes failed attempts atomically. The client receives a
short opaque session bound to a keyed digest of the gateway-verified client
address. Ambiguous forwarding headers, database errors, and retention-RPC
errors fail closed with `503`.

Login retains a bounded legacy compatibility contract: any non-empty value up
to 1,024 JavaScript code units may be checked against an existing hash.
Newly rotated passphrases alone enforce the 12–72 UTF-8-byte bcrypt policy.

`admin-list`, `admin-delete`, and `admin-rotate` accept only that session.
Rotation atomically updates the credential epoch and revokes outstanding
sessions. The old destructive `cleanup` endpoint is a generic `410 no-store`
tombstone. `admin_security_prune()` is service-role-only; production must also
schedule and monitor its daily retention run.

The migration must precede the Edge functions. No production limiter or
session guarantee is claimed until concurrent-failure and database-failure
probes pass against the deployed environment.

## 3. Share capabilities and compatibility URLs — implemented, deploy unverified

New view capabilities travel in `/s#view=<token>`, then only in an exact
`Authorization: Bearer` header. `share-view` does not return the note slug,
marks responses `no-store`, and returns generic errors without logging raw
request data. Rotating a view capability revokes the previous generation.
`share-rename` is a `410 no-store` tombstone.

Legacy `/s/:token` is a 30-day compatibility shell. Before React starts it
moves the token into the fragment, removes it from the visible path, and uses
`no-store`/`no-referrer`; after the configured deadline it fails closed. The
Worker never forwards the raw path token. Platform logs, traces, and cache
keys still require deployment-time review and redaction.

## 4. Public `notes` access — fixed by the cutover migration, not yet operationally proven

`20260724000000_atomic_capability_cutover.sql` dynamically drops every policy
on `public.notes` and revokes all direct privileges from `PUBLIC`, `anon`, and
`authenticated` in one transaction. Capability, update, checkpoint, and share
tables remain default-deny. The SPA uses narrow Edge APIs; legacy content is
available only through the exact-match read-only `legacy-note-open` function.

Do not apply this migration until the dual-mode client and capability APIs have
completed the required 48-hour production soak. A local migration test is not
evidence that the deployed database is closed. After cutover, probe both
`anon` and `authenticated` for failed select/insert/update/delete attempts.
Rollback is API read-only and must never recreate public policies.

## 5. Realtime and durable persistence — implemented, deploy unverified

Capability notes use private `note:<noteId>` channels. Five-minute Realtime
JWTs carry note ID, scope, generation, and rollback claims; RLS on
`realtime.messages` permits receive for active capabilities and send only for
owner/edit scopes. The forged legacy `slug-abandoned` control event is removed,
and accepted event types and payload sizes are bounded.

The client persists each Yjs update to an IndexedDB outbox before broadcast or
HTTP sync. `note-sync` acknowledges an update ID idempotently; only acknowledged
items are removed. Peers may persist the same validated update hash. Checkpoint
compaction uses `throughSequence` plus version/encryption CAS. Locked-note
updates, checkpoints, recovery snapshots, and outbox entries remain ciphertext;
locking purges plaintext persistence before the secure mode is accepted.

Production must still prove reconnects, reversed delivery, sub-800 ms
navigation, concurrent saves, JWT refresh, encrypted recovery, outbox backlog,
and checkpoint conflicts during the soak. Oversized existing data must be
quarantined read-only, never truncated.

## 6. Privacy boundary — implemented in code, operations need review

The application no longer calls `ipapi.co`; locale selection uses browser
signals. Privacy copy, the extension manifest, and runtime behavior prohibit
logging note content, slug, capability/share token, URL fragment, or raw IP.
Only aggregate API errors, authorization denials, outbox backlog, and
compaction failures are permitted. Deployment logging and retention settings
must be checked separately.

## 7. Toolchain security exceptions — verified locally

The otherwise deferred Vite major upgrade is included because
[GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)
affects every Vite release through `6.4.2`; `6.4.3` is the first patched line
compatible with the current plugins, and there is no patched Vite 5 release.
[GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)
affects Vitest versions below `3.2.6`, so Vitest and
`@vitest/coverage-v8` are pinned together at `3.2.6`.

These exceptions do not authorize other framework majors. Frozen install,
dependency audit, lint, Knip, app/Node/tooling/Edge typechecks, unit coverage,
production build, actionlint, extension E2E, and browser smoke remain release
gates.

### Open dependency-audit blocker — no exception granted

`bun audit --audit-level=high` currently reports one high finding:
[`brace-expansion <=5.0.7` (GHSA-mh99-v99m-4gvg)](https://github.com/advisories/GHSA-mh99-v99m-4gvg).
It is present only in the development/build dependency graph through ESLint,
TypeScript-ESLint, `@vitest/coverage-v8`, and
`vite-plugin-pwa → workbox-build`. `bun audit --production --audit-level=high`
is clean.

The only patched release is `5.0.8`, but Bun supports only global overrides.
Forcing that version into legacy `minimatch` ranges is neither range-compatible
nor API-compatible. Current compatible ESLint/Vitest upgrades can reduce some
paths, but Workbox `7.4.1` still retains one vulnerable path and the current
`vite-plugin-pwa` line has no compatible upstream replacement.

This is not accepted, suppressed, or a CI exception. The `quality` audit gate
must remain red; merge and release remain blocked until a compatible upstream
toolchain update, a separately reviewed PWA replacement, or a separately
reviewed fork removes the finding.

## Scan triage rule

Treat any finding about deployed direct-table access, public Realtime,
content-bearing crawler output, raw token paths, or fail-open admin rate limits
as open until staging and production evidence proves otherwise. The repository
contains the intended fixes, but merge status is not deployment status.
