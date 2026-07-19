# Immediate containment rollout

This change set is code-only. It must not be applied to staging or production
without the explicit checkpoint below.

## Required checkpoint

1. Create and verify a database backup/PITR restore point.
2. In staging, prove that the Supabase gateway overwrites client-supplied
   `X-Forwarded-For` and supplies exactly one IP literal. If that cannot be
   demonstrated, leave the admin functions disabled; they intentionally return
   `503` rather than trust an ambiguous header.
3. Provision `ADMIN_RATE_LIMIT_HMAC_SECRET` with at least 32 random bytes and
   set `ADMIN_SESSION_TTL_MINUTES` between 5 and 30 (default: 15). Do not reuse
   the admin passphrase as the HMAC secret.

## Migration and deployment order

1. Disable or tombstone the legacy admin and cleanup Edge endpoints at the
   gateway before changing SQL. Verify the old passphrase-body endpoints are
   unreachable or return fail-closed `503`; do not rely on their baseline
   limiter after the `ip` column is renamed.
2. Apply `20260522000000_admin_rate_limit.sql` if it is not already recorded.
3. Apply `20260719000000_security_immediate_containment.sql`. Confirm public
   DELETE is revoked, old raw-IP limiter rows were purged, admission and pass
   rotation RPCs are executable only by `service_role`, and `admin_sessions` is
   service-role-only.
4. Deploy `admin-session`, `admin-list`, `admin-delete`, `admin-rotate`, and
   `cleanup` while their public routes remain disabled. Smoke-test concurrent
   wrong passes, DB-error `503`, session expiry, logout revocation, subject
   binding, and rotation revocation on staging.
5. Enable the replacement admin and cleanup endpoints only after those smoke
   tests pass. The passphrase body contract must remain unavailable.
6. Deploy the `share-rename` tombstone. Verify it returns `410` and `no-store`
   without initializing a database client, then purge cached responses for the
   retired endpoint.
7. Deploy the generic share Worker before purging `/s/*` cache entries. Verify
   raw, percent-encoded, uppercase, `www`, and trailing-slash share paths return
   the same token-free, `no-store`, non-indexable crawler response.
8. Deploy the SPA and extension containment changes. Verify encryption gates,
   bounded Realtime events, locale-only language selection, privacy copy, and
   stalled PWA updates before advancing beyond staging.

No function in this sequence logs a passphrase, session token, locator, or raw
client address.

## Rollback

Rollback is API read-only. Disable the new admin functions and keep the public
DELETE policy and table privilege revoked. Do not recreate `USING (true)` or
restore direct anonymous DELETE. Restore application availability from the
verified checkpoint only after incident review; session/limiter tables may be
discarded because they contain no note content.
