# Security findings — repository and rollout status

Production legacy write path is still live (`NotePage` `legacyOnly`,
`public.notes`). Additive SQL `20260722000000_capability_backend.sql` is
applied on production: columns, legacy-only RLS, capability tables, and a
closed kill switch (`writes_enabled=false`, `private_realtime_enabled=false`).
Additive SQL `20260727000000_capability_sync_conflict_codes.sql` is also
applied: `capability_updates_append` returns `append_encryption_conflict` and
`capability_checkpoint_append` returns `checkpoint_encryption_conflict` /
`checkpoint_version_conflict`; `capability_note_manage` still uses generic
`version_conflict`.
Atomic SQL `20260724000000_atomic_capability_cutover.sql` has not been
applied. Anon still has direct table grants; `notes` still has the three
Legacy policies. Capability SPA canary remains off
(`VITE_CAPABILITY_ROUTES_ENABLED` is not true; live `version.json`
`capabilityRoutesEnabled` is false). Local tests prove capability code
contracts only; 240, canary, soak, and post-cutover probes remain mandatory
gates. Do not treat 220 or 270 as authorization to flip the canary or apply 240.

In the target post-cutover architecture, slugs are locators rather than
authorization credentials. New notes use owner/edit/view capabilities, while
legacy notes are exact-match read-only and may only be copied into a new
capability-managed note.

## 1. Legacy metadata and crawler previews — production verified

`note-meta` is deployed as a generic `410 no-store` tombstone. It does not parse
a token, initialize a database client, or return content or a locator. The
deployed `note-meta` endpoint is production-verified. Credential-free probes on
2026-08-30 covered no-query, synthetic slug, synthetic token, and combined-query
variants; each returned `{"found":false}`, `410`, `Cache-Control: no-store`, and
`CDN-Cache-Control: no-store` without echoing a locator, token, or content. The
Cloudflare Worker returns generic, non-indexable, `no-store` HTML for crawler
requests to legacy note and share paths before consulting metadata or Cache
API.

Worker crawler containment is live and verified in production. The ordered
runbook in `docs/security/immediate-containment-rollout.md` remains authoritative
for any future Worker, cache-purge, or tombstone change. Rollback must retain
generic containment.

## 1a. Legacy `raw` dump — production verified

The committed `raw` Edge function is a generic `410 no-store` tombstone matching
`note-meta`. It does not parse a locator, initialize a database client, or
return note bytes. Keep the name deployed as this handler; deleting it would
404, which is weaker if something still calls the path. The deployed `raw`
endpoint is production-verified. Credential-free probes on 2026-09-01 covered
`GET /functions/v1/raw/!`; that invalid extra path returned `{"found":false}`,
`410`, `content-type: application/json`, `Cache-Control: no-store`, and
`CDN-Cache-Control: no-store` without echoing a locator or content. `POST` to
the same path returned `405` with the same JSON `no-store` body. `OPTIONS`
returned `200`. This is not the old `400` `text/plain` dump handler. The
tombstone was deployed ~2026-09-01 19:47 ICT via Lovable Cloud Edge function
`raw` only. GitHub source tombstone was PR #32; the live SPA origin is
`3244b08` with canary off.

Do not `GET /functions/v1/raw` with no extra path; the last segment `raw` is a
legal locator. Do not probe production `raw` with a real locator. Probe only
`GET /raw/!` (or another invalid extra path).

The live SPA editor path does not need this endpoint (`RawView` reads
`public.notes` directly). ExportMenu no longer copies `/functions/v1/raw/...`;
the remaining export action copies the canonical public RawView URL
`https://note.syrin.online/{slug}.md` (`/:slug.md`). `share-revoke` remains live
and is out of scope for this containment.

## 1b. Legacy `legacy-note-open` dump — committed 410 tombstone, production not deployed

The committed `legacy-note-open` Edge function is a generic `410 no-store` tombstone
matching `raw`/`note-meta`. It does not parse a locator, initialize a database
client, or return note bytes. Keep the name in git as this handler; deleting the
folder would 404, which is weaker if something later calls the path.

Git is now a 410 tombstone and production remains 404 not-deployed.
Credential-free GET/HEAD/OPTIONS probes on 2026-09-01 ~22:15 ICT against the
functions host returned gateway `NOT_FOUND`. Do not POST a locator to it. Do
not claim a production 410 deploy. Accidental deploy from this git source now
returns 410 instead of restoring the unauthenticated service-role dump. Default
production SPA no longer contains quoted `legacy-note-open` (PR #41, live
origin `3244b08`, canary off).

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

## 3a. Additive capability backend SQL 220 — production verified

Verified 2026-09-01 ~23:31 ICT against production Lovable Cloud project
`8f71f52d-c666-442f-bfb8-5f0a4e0ac1d5` / Supabase `onfzjmfjldsbthchssfr`.
There is no `supabase_migrations.schema_migrations` relation on this database;
do not claim a recorded migration version. Do not re-run
`20260722000000_capability_backend.sql`: the singleton INSERT is not
idempotent.

`public.notes` already has the SQL 220 columns: `note_id` (uuid, default
`gen_random_uuid()`), `capability_managed` boolean NOT NULL default false,
`sync_status` `note_sync_status` NOT NULL default `'legacy'`, plus
`encryption_version`, `payload_limit_bytes`, `storage_limit_bytes`,
`update_limit_count`, `checkpoint_limit_count`, and `deleted_at`.

Notes RLS policies are only these three: `Legacy notes remain readable`
USING (`NOT capability_managed`); `Legacy notes remain creatable` WITH CHECK
(`NOT capability_managed AND sync_status = 'legacy'`); `Legacy notes remain
writable` USING (`NOT capability_managed`) WITH CHECK
(`NOT capability_managed AND sync_status = 'legacy'`). The old
`Anyone can * notes` policies are gone.

Aggregate counts only: 61 notes, 0 `capability_managed`, 0 with
`sync_status` other than `legacy`. The `anon` role still sees all 61 (RLS
allows legacy rows).

`anon` and `authenticated` still have SELECT, INSERT, UPDATE on
`public.notes` (also REFERENCES, TRIGGER, TRUNCATE). SQL 240 would REVOKE
these and drop every notes policy; that has not happened.

Tables present: `note_capabilities`, `note_updates`, `note_checkpoints`,
`note_realtime_memberships`, `capability_admission_windows`,
`capability_runtime_settings`. Kill switch row:
`capability_runtime_settings` `singleton=true`, `writes_enabled=false`,
`private_realtime_enabled=false`. Function `capability_note_import_legacy`
is absent (SQL 240 not applied). Function `capability_checkpoint_append`
exists (SQL 230 objects are present) but capability writes remain fail-closed
via the kill switch. This §3a attestation is 220 vs 240 vs canary; it is not
a 230 soak claim. SQL 270 conflict-code verification is §3b.

Live SPA `https://note.syrin.online/version.json` (fetched 2026-09-01):
`deployedSha` `3244b08cc1f9c178a0e99ef8fec63bdaeb3d7424`,
`capabilityRoutesEnabled` false, `builtAt` `2026-09-01T14:28:00.045Z`.
Canary off. Git `main` may be ahead of this origin SHA for docs/Edge-only
PRs; that is expected and does not change canary status.

## 3b. Additive capability sync conflict codes SQL 270 — production verified

Verified 2026-09-01 ~23:59 ICT / 2026-09-02 ~00:03 ICT against production
Supabase `onfzjmfjldsbthchssfr` (same project as §3a). Confirmed via
`pg_get_functiondef`, not via `schema_migrations` — that relation still does
not exist. Do not re-run `20260722000000_capability_backend.sql` or
`20260727000000_capability_sync_conflict_codes.sql`. Function REPLACE is
less dangerous than 220's singleton INSERT, but this record is attestation
only.

`capability_updates_append` returns `append_encryption_conflict` (not generic
`version_conflict`) on encryption mismatch. `capability_checkpoint_append`
returns `checkpoint_encryption_conflict` and `checkpoint_version_conflict`.
`capability_note_manage` still uses generic `version_conflict`; that is
expected — 270 does not rewrite manage.

Kill switch still closed: `writes_enabled=false`,
`private_realtime_enabled=false`. SQL 240 still not applied:
`capability_note_import_legacy` is absent; anon still has notes grants; the
three Legacy policies remain.

SPA canary still off: live `https://note.syrin.online/version.json`
`capabilityRoutesEnabled` false, `deployedSha`
`3244b08cc1f9c178a0e99ef8fec63bdaeb3d7424`. Docs/Edge-only git may be ahead;
that does not change canary status.

Edge HTTP for `note-session`, `note-sync`, and `note-manage` on production
and staging `dmfrydhubosecaatjjwf` matches git mapper
`capabilityCorsHeaders` (includes `x-snote-auth`, `x-legacy-share`,
`Retry-After`; OPTIONS 200 `ok`; GET 405 `{"error":"method not allowed"}`
and POST `{}` 401 `{"error":"unauthorized"}` with no `code`; both cache
headers `no-store`). Live 401 rather than 503 `unavailable` means HMAC and
service-role env are present. Function source SHA cannot be confirmed (list
403); git function bodies last `0e1ea254` (2026-08-25), mapper
`_shared/capability-edge.ts` last `b0417482` (2026-07-27, 270 codes). HEAD
is docs-only. This is not a deploy.

This is not a soak claim. This is not authorization to flip the canary or
`writes_enabled`, or to apply 240.

## 4. Public `notes` access — fixed by the cutover migration, not yet operationally proven

Production SQL 220 (see §3a) and SQL 270 (see §3b) do not change this: 240 is
still not applied.

`20260724000000_atomic_capability_cutover.sql` dynamically drops every policy
on `public.notes` and revokes all direct privileges from `PUBLIC`, `anon`, and
`authenticated` in one transaction. Capability, update, checkpoint, and share
tables remain default-deny. The SPA uses narrow Edge APIs. Git `legacy-note-open`
is now a generic `410 no-store` tombstone rather than a notes dump, and
production remains 404 not-deployed. Do not claim a production 410 deploy.

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
affects Vitest versions below `3.2.6`. Vitest and `@vitest/coverage-v8` remain
exactly aligned and pinned together at `3.2.6`.

These exceptions do not authorize other framework majors. Frozen install,
dependency audit, lint, Knip, app/Node/tooling/Edge typechecks, unit coverage,
production build, actionlint, extension E2E, and browser smoke remain release
gates.

### Resolved dependency-audit blocker

The 2026-07-27 toolchain refresh removes the high finding previously reported
by `bun audit --audit-level=high`:
[`brace-expansion <=5.0.7` (GHSA-mh99-v99m-4gvg)](https://github.com/advisories/GHSA-mh99-v99m-4gvg).
The finding was limited to the development/build dependency graph through
ESLint, TypeScript-ESLint, `@vitest/coverage-v8`, and
`vite-plugin-pwa → workbox-build`.

The only patched `brace-expansion` release at the time was `5.0.8`, so it is
not forced into legacy `minimatch` ranges. Instead, ESLint 10 removes its
legacy consumer. Vitest's build-only `test-exclude@8.0.0` override retains the
7.x runtime source while moving its dependency graph to patched lines. All
remaining compatible 5.x paths now resolve to `brace-expansion@5.0.9` (see the
2026-08 refresh below).

Workbox `7.4.1` still reaches EJS solely through its build-time Rollup plugin.
EJS declares Jake `^10.8.5`, whose `filelist@1` chain cannot receive the patch;
`filelist@2.0.2` retains the API Jake 10 uses while moving its only dependency
to the patched `minimatch` line. Because this graph contains one `filelist`
instance and the repository's Node floor satisfies its engine requirement, a
narrowly pinned `filelist@2.0.2` override removes that final build-only path
without globally replacing `glob`, `minimatch`, or `brace-expansion`. The full
audit remains mandatory in both CI workflows; no advisory suppression or audit
exception is granted.

### Resolved dependency-audit blocker (2026-08 refresh)

The 2026-08-17 lockfile refresh clears the three high advisories reported by
`bun audit --audit-level=high` after the 2026-07 toolchain refresh:

- `fast-uri` (`ajv` path) [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7),
  resolved `3.1.4` → `3.1.5`;
- `brace-expansion` (ESLint, TypeScript-ESLint, `@vitest/coverage-v8`,
  `vite-plugin-pwa → workbox-build` paths)
  [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895),
  resolved `5.0.8` → `5.0.9`;
- `nanoid` (`postcss` path)
  [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8),
  resolved `3.3.16` → `3.3.18` (the advisory floor moved from `3.3.17` to
  `3.3.18` between 2026-08-09 and 2026-08-17).

The fix is a three-line `bun.lock` resolution update with official registry
integrity hashes. `package.json` ranges, overrides, and every other resolution
are unchanged. All three bumps stay inside the dependents' existing semver
ranges, so no new override or direct dependency was introduced.
A 2026-09-01 lockfile bump of `browserslist` `4.28.2` → `4.28.7` (official registry integrity; `update-browserslist-db` unchanged) clears [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) and [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g); still no override.

## Scan triage rule

Treat any finding about deployed direct-table access, public Realtime,
content-bearing crawler output, raw token paths, or fail-open admin rate limits
as open until staging and production evidence proves otherwise. The repository
contains the intended fixes, but merge status is not deployment status.
