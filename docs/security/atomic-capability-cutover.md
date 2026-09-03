# Atomic capability cutover

This release removes browser access to the `notes` table. It is a staged
production operation, not a migration to apply automatically after merge.

## Immutable decisions

- Legacy slugs are locators, not proof of ownership.
- A legacy URL is exact-match, read-only, and `no-store`.
- “Duplicate securely” creates a different capability-managed note. It never
  assigns an owner capability to the legacy row.
- Rollback leaves direct-table access closed. The rollback mode is capability
  API read-only.
- Application, Edge Function, Worker, and database telemetry must not record
  note content, raw slug, capability/share token, URL fragment, or raw IP.

## Release and soak gate

1. Deploy the PR4 dual-mode client and capability APIs without applying
   `20260724000000_atomic_capability_cutover.sql`.
2. Keep the dual-mode release in production for at least 48 continuous hours.
3. Review aggregate-only signals over that entire window:
   - note-session, note-sync, and Realtime error/denial rates;
   - IndexedDB outbox age and backlog;
   - acknowledgement latency and duplicate `updateId` rate;
   - Realtime reconnect/JWT refresh failures;
   - checkpoint compaction success, CAS conflicts, and quarantines.
4. Stop if any durable outbox is stranded, acknowledgements regress, an
   encrypted payload is rejected, or the privacy/log review finds a raw
   locator, token, content value, or IP.
5. Record the start/end timestamps, dashboards, staging migration evidence,
   Lovable Cloud daily snapshot verification (findings §3c; PITR is not
   available on this Tiny project), reviewer, and go/no-go decision in the
   tracking issue. A passing local test run does not satisfy this production
   gate.

## Atomic cutover order

1. Verify the Lovable Cloud daily snapshot panel (see
   `docs/security-findings.md` §3c). PITR is not available on this Tiny project.
   Daily snapshot verify is done as of 2026-09-02. Immediate pre-go re-check
   2026-09-02 ~11:23 ICT: latest snapshot still `2026-09-01 19:33:22 UTC`.
   Named production go the same day:
   `SELECT public.capability_runtime_set(true, false);` —
   `writes_enabled=true`, `private_realtime_enabled=false` (findings §3d).
   Origin canary go 2026-09-02 ~12:01 ICT: first canary `version.json`
   `deployedSha` `c5914c8e8f953d5e8ed877d8c892b6e0941095e7`,
   `capabilityRoutesEnabled` true (findings §3e). Soak ≥48h started from
   that first canary. Same-canary origin SHA bump 2026-09-02 ~16:03 ICT:
   `deployedSha` `386421e87f7eac2864f1a40655a2b0255b4332d6`, still
   `capabilityRoutesEnabled` true. Same-canary origin SHA bump
   2026-09-02 ~17:52 ICT:
   `deployedSha` `4baa89665ee1d75dcafb238d62fbed9b18f8a7c7`, still
   `capabilityRoutesEnabled` true. Same-canary origin SHA bump
   2026-09-02 ~19:22 ICT:
   `deployedSha` `7335fadce1dc96ee5548deb2e7e75b2bbff57c40`, still
   `capabilityRoutesEnabled` true. Same-canary origin SHA bump
   2026-09-02 ~20:41 ICT:
   `deployedSha` `8d9ce025d05c65664afaba78b9b145bf137edb83`, still
   `capabilityRoutesEnabled` true. Same-canary origin SHA bump
   2026-09-02 ~22:41 ICT:
   `deployedSha` `e39caacd6b37518d61498262ba38506de64f5545`, still
   `capabilityRoutesEnabled` true. Same-canary origin SHA bump
   2026-09-02 ~23:49 ICT:
   `deployedSha` `4c7918619eb6d9b56523444fa1eb8d154e0eba01`, still
   `capabilityRoutesEnabled` true. Same-canary origin SHA bump
   2026-09-03 ~02:31 ICT:
   `deployedSha` `92aa4e0db313f2abec12cc233175e5f86dd4b24a`, still
   `capabilityRoutesEnabled` true. Same-canary origin SHA bump
   2026-09-03 ~04:24 ICT:
   `deployedSha` `1f21777e7d562b4ae5f71bc7d72d7df44dd50557`, still
   `capabilityRoutesEnabled` true. Same-canary origin SHA bump
   2026-09-03 ~05:07 ICT:
   `deployedSha` `d15aee5d243630abc7f143225b2ca9cdb44dd7b2`, still
   `capabilityRoutesEnabled` true. Same-canary origin SHA bump
   2026-09-03 ~06:34 ICT:
   `deployedSha` `4c84659244f01153bab6c6f4655fe8725df419b4`, still
   `capabilityRoutesEnabled` true. Same-canary origin SHA bump
   2026-09-03 ~10:30 ICT:
   `deployedSha` `4ef734ee97a93d1922eefde01a6453c828f9aed3`, still
   `capabilityRoutesEnabled` true. Same-canary origin SHA bump
   2026-09-03 ~15:43 ICT:
   live `deployedSha` `27da93eb2db7fa670f721ce2ecbb79971f489bb2`, still
   `capabilityRoutesEnabled` true. This is not soak-complete.
   Do not treat snapshot verify as `capability_runtime_set`.
   This is not `LEGACY_SHARE_CUTOFF`, soak-complete,
   SQL 240, Worker redeploy, or `private_realtime_enabled`. Do not skip remaining order.
2. Record the actual planned cutover timestamp, add exactly 30 days, and set
   that canonical ISO timestamp as both Edge secret `LEGACY_SHARE_CUTOFF` and
   frontend build variable `VITE_LEGACY_SHARE_CUTOFF`. Missing or malformed
   values fail closed at runtime.
3. Production `legacy-note-open` is already the generic `410 no-store` tombstone;
   do not restore a dump. Capability functions are SHA-pinned.
   Deploy share compatibility code and the Cloudflare Worker. Do not deploy
   the migration yet.
4. Run `bun run cutover:verify` from the exact production build artifact with
   `CAPABILITY_CUTOVER_AT`, both cutoff variables, and the credential-free
   `CAPABILITY_SHARE_VIEW_URL`. It checks cutover + 30 days, finds the value in
   the built JS, probes the deployed Edge status endpoint, and aborts on any
   mismatch. Attach its output to the checkpoint review.
5. Verify `/s/:token` becomes `/s#legacy=...` before React starts and that both
   responses and the Worker path are `no-store`, `no-referrer`, and noindex.
6. Verify `CAPABILITY_WRITE_DISABLED` is unset and capability create, sync,
   owner management, view, revoke, and encrypted duplicate all pass on staging.
7. Apply `20260724000000_atomic_capability_cutover.sql`. It dynamically drops
   every `public.notes` policy and revokes all direct table privileges from
   `PUBLIC`, `anon`, and `authenticated` in one transaction.
8. Run the post-cutover probes below before declaring the deployment healthy.

## Required probes

- `anon` and `authenticated` cannot select, insert, update, or delete `notes`;
  they also cannot access capability/update/checkpoint/share tables directly.
- A capability for note A cannot open, sync, rename, rotate, or delete note B.
- A legacy locator can open only that exact legacy row and cannot persist an
  edit, lock transition, rename, delete, or new share.
- “Duplicate securely” preserves plaintext or client-side ciphertext and
  navigates to `/<new-slug>#owner=<token>`. Simulate a lost first response and
  confirm retry recovers the same owner/checkpoint without adding rows.
- A revoked share fails immediately and is never served from browser/CDN cache.
- Capability create/sync/manage still work with direct table grants revoked.

## Compatibility expiry

The old `/s/:token` shell and legacy `x-legacy-share` API expire at the one
deployment value configured above: the actual cutover timestamp plus exactly
30 days. The bootstrap rewrites the path token into the URL fragment during
the window. After the deadline it discards the raw token and the Edge API
returns `410 no-store`. Missing or malformed configuration also expires the
compatibility path immediately. The Worker contains raw path tokens forever;
it never forwards them to origin even after compatibility expires. Capability
`/s#view=<token>` links do not expire under this compatibility rule.

## Rollback

1. Set `CAPABILITY_WRITE_DISABLED=true` on Edge Functions. `note-session`
   continues opening existing capabilities, while create, sync, and manage
   return read-only errors. Newly minted Realtime JWTs carry the rollback claim
   and cannot broadcast; allow at most five minutes for older JWTs to expire.
2. Keep the cutover migration applied. Never recreate a permissive policy or
   grant `notes` privileges to `PUBLIC`, `anon`, or `authenticated`.
3. Keep `legacy-note-open` as the generic `410 no-store` tombstone.
   Do not restore a dump. Keep all private routes `no-store`.
4. Roll back the SPA/Worker/API bundle only to a revision that understands
   read-only legacy access. Do not roll back to a direct-table client.
5. Diagnose and repair the capability API, then unset the write kill switch
   only after staging verification and a second production review.

## Evidence to attach to the stacked draft PR

- threat model and the exact migration SHA;
- staging database privilege diff and post-cutover probes;
- 48-hour soak timestamps and aggregate dashboards;
- Worker/share cache purge evidence;
- frozen install, lint, all typechecks, unit/integration tests, build, audit,
  actionlint, and the critical browser smoke artifact;
- an explicit statement that production migration/deployment was not performed
  by the code-review PR itself.
