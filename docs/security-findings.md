# Security findings — repository and rollout status

Production legacy write path is still live (`NotePage` `legacyOnly`,
`public.notes`). Additive SQL `20260722000000_capability_backend.sql` is
applied on production: columns, legacy-only RLS, capability tables, and
`writes_enabled=true`, `private_realtime_enabled=false` (see §3d).
Additive SQL `20260727000000_capability_sync_conflict_codes.sql` is also
applied: `capability_updates_append` returns `append_encryption_conflict` and
`capability_checkpoint_append` returns `checkpoint_encryption_conflict` /
`checkpoint_version_conflict`; `capability_note_manage` still uses generic
`version_conflict`.
Atomic SQL `20260724000000_atomic_capability_cutover.sql` has not been
applied. Anon still has direct table grants; `notes` still has the three
Legacy policies. Capability SPA canary is on
(`VITE_CAPABILITY_ROUTES_ENABLED` is true; live `version.json`
`capabilityRoutesEnabled` is true; see §3e). Dual-mode `NotePage`
(`legacyOnly={!canary}`): plain slug stays legacy; `#owner`/`#edit` may
open capability polling. Home still does not mint capabilities.
`VITE_CAPABILITY_AUTH_ENABLED` and `VITE_ADMIN_PANEL_ENABLED` stayed
false. Local tests prove capability code contracts only; 240, soak, and
post-cutover probes remain mandatory gates. Soak ≥48h started from the
first §3e origin canary. Do not treat 220, 270, `writes_enabled`, or this
origin canary as authorization to apply 240 or flip
`private_realtime_enabled`.

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
generic containment. Live Worker identity is §1c; it is not the SPA origin SHA.

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
`raw` only. GitHub source tombstone was PR #32; at that raw deploy the SPA
origin was `fe18302f` with canary off. Current origin is §3e.

Do not `GET /functions/v1/raw` with no extra path; the last segment `raw` is a
legal locator. Do not probe production `raw` with a real locator. Probe only
`GET /raw/!` (or another invalid extra path).

The live SPA editor path does not need this endpoint (`RawView` reads
`public.notes` directly). ExportMenu no longer copies `/functions/v1/raw/...`;
the remaining export action copies the canonical public RawView URL
`https://note.syrin.online/{slug}.md` (`/:slug.md`). `share-revoke` remains live
and is out of scope for this containment.

## 1b. Legacy `legacy-note-open` dump — production verified

The committed `legacy-note-open` Edge function is a generic `410 no-store` tombstone
matching `raw`/`note-meta`. It does not parse a locator, initialize a database
client, or return note bytes. Keep the name deployed as this handler; deleting it
would 404, which is weaker if something still calls the path. The deployed `legacy-note-open` endpoint is production-verified.
Credential-free probes on 2026-09-02 ~04:20 ICT against production functions host
`onfzjmfjldsbthchssfr` covered unauthenticated calls with no locator in the body:
`OPTIONS /functions/v1/legacy-note-open` returned `200` body `ok` (`Allow-Methods`
POST, OPTIONS); `GET` returned `405` `{"found":false}`, `content-type:
application/json`, `Cache-Control: no-store`, and `CDN-Cache-Control: no-store`;
`POST {}` returned `410` with the same JSON `no-store` body. This is not gateway
`NOT_FOUND` / 404. Do not POST a locator to it. The tombstone was deployed
2026-09-02 via Lovable Cloud Edge function `legacy-note-open` only. Git source
of the live 410 tombstone includes PR #56 (`eab48218`); the Edge function comment
no longer claims gateway 404. Hosted function was re-pinned 2026-09-02 ~06:20 ICT from
that git; HTTP contract unchanged from the earlier 2026-09-02 ~04:20
production-verified 410. Default production SPA no longer contains quoted
`legacy-note-open` (PR #41; at that 410 pin live origin was `fe18302f`,
canary off; current origin is §3e). `share-revoke`
remains live (POST `{}` still 400, not 410) and is out of scope for this
containment.

## 1c. Production Worker identity — live 2026-09-02

Production Worker `syrin-prerender` was redeployed 2026-09-02 ~03:35 ICT from
PR #52.

- Git SHA: `9fcc58bc3690c1a2ffd74f465e219172d25376a3` (short `9fcc58bc`)
- Cloudflare Version ID: `b4d1a94e-b391-4682-841a-10dca111b1d6`
- Replaces previous Cloudflare Version ID `ba859faf…`
- `wrangler.toml` still: observability, logs, and traces disabled;
  `workers_dev` false; `ORIGIN_HOST` `snote-g4-origin.pages.dev`
- Live origin-fetch behavior: runtime and immutable assets forward only a
  conservative `__WB_REVISION__` query; locator, token, home, public, note,
  and share queries remain stripped
- Staging `syrin-prerender-staging` was not deployed

This is not the live SPA origin. Origin is `e39caacd` (see §3e).
Do not claim origin is `9fcc58bc`. Git `main` includes this Worker SHA and
may be ahead for later docs-only PRs; that does not change Worker identity.

Canary is on (`capabilityRoutesEnabled` true; see §3e). SQL 240 is not
applied. `writes_enabled=true`, `private_realtime_enabled=false` (see §3d).
Soak ≥48h started from the first §3e origin canary.

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
Worker never forwards the raw path token. Origin fetch for runtime and
immutable assets may forward only a conservative `__WB_REVISION__` query
(PR #52, live); locator, token, home, public, note, and share queries are
still stripped. Platform logs, traces, and cache keys still require
deployment-time review and redaction. See §1c.

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
`capability_runtime_settings`. At that 2026-09-01 check, kill switch row:
`capability_runtime_settings` `singleton=true`, `writes_enabled=false`,
`private_realtime_enabled=false`. Current production row is §3d
(`writes_enabled=true`, Realtime still false). Function
`capability_note_import_legacy` is absent (SQL 240 not applied). Function
`capability_checkpoint_append` exists (SQL 230 objects are present). Live
SPA still does not mount `CutoverNotePage`. This §3a attestation is 220 vs
240 vs canary; it is not a 230 soak claim. SQL 270 conflict-code verification
is §3b. Current origin canary is §3e.

At that 2026-09-01/02 SQL 220 check, live SPA
`https://note.syrin.online/version.json` (same fields on
`https://snote-g4-origin.pages.dev/version.json`):
`deployedSha` `fe18302fb650b98eaee414e34e61db5cf06acc61`,
`capabilityRoutesEnabled` false, `builtAt` `2026-09-01T19:55:38.557Z`,
`buildId` `1788292524728-ej6uxgse`.
Canary off at that check. Origin then included PR #47 PWA recovery (`clientsClaim` off),
PR #48 shortened Update toast (no `update.fallback_cleanup` / cookie
paragraph), and PR #50 enc-meta error + Retry gate. Do not claim origin
is `9fcc58bc`. Live Worker identity is §1c.

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

At that 2026-09-01 check the row was `writes_enabled=false`,
`private_realtime_enabled=false`. Current production row is §3d
(`writes_enabled=true`, Realtime still false). SQL 240 still not applied:
`capability_note_import_legacy` is absent; anon still has notes grants; the
three Legacy policies remain.

At that 270 check SPA canary was still off: live
`https://note.syrin.online/version.json`
`capabilityRoutesEnabled` false, `deployedSha`
`fe18302fb650b98eaee414e34e61db5cf06acc61`, `builtAt`
`2026-09-01T19:55:38.557Z`, `buildId` `1788292524728-ej6uxgse`.
Origin then included PR #47 PWA recovery (`clientsClaim` off), PR #48
shortened Update toast (no `update.fallback_cleanup` / cookie
paragraph), and PR #50 enc-meta error + Retry gate. Do not claim origin
is `9fcc58bc`. Current origin canary is §3e. Live Worker identity is §1c.

Production `note-session`, `note-sync`, and `note-manage` were SHA-pin
redeployed 2026-09-02 ~05:22 ICT from git via Lovable Cloud (0.8 credits),
those three names only. Independent credential-free probes after that
deploy against production functions host `onfzjmfjldsbthchssfr`
(unauthenticated, empty POST body, no locator) for each of those three
names still match git mapper `capabilityCorsHeaders` (includes
`x-snote-auth`, `x-legacy-share`, `Retry-After`): OPTIONS 200 `ok`; GET
405 `{"error":"method not allowed"}` with `cache-control: no-store` and
`cdn-cache-control: no-store`; POST `{}` 401 `{"error":"unauthorized"}`
(no `code` field) with both no-store headers. Still 401 not 503
`unavailable` (HMAC and service-role env present). Still not 410.
`share-revoke` POST `{}` still 400 `invalid token`. `legacy-note-open`
POST still 410. At that Edge SHA-pin, origin was still `fe18302f` /
`capabilityRoutesEnabled` false. Worker still §1c (`9fcc58bc` /
`b4d1a94e`). Canary off at that pin. SQL 240 not applied. Current kill
switch: §3d (`writes_enabled=true`, Realtime still false). Current origin
canary is §3e.

Staging `dmfrydhubosecaatjjwf` was not redeployed this time. Earlier
staging HTTP matched git mapper `capabilityCorsHeaders` (includes
`x-snote-auth`, `x-legacy-share`, `Retry-After`; OPTIONS 200 `ok`; GET
405 `{"error":"method not allowed"}` and POST `{}` 401
`{"error":"unauthorized"}` with no `code`; both cache headers
`no-store`). That is a historical HTTP match, not a 2026-09-02 staging
SHA-pin.

Git function bodies last `0e1ea254` (2026-08-25, PR #19). Mapper
`_shared/capability-edge.ts` last `b0417482` (2026-07-27, 270 codes).
`verify_jwt = false` remains required. Production was redeployed from
git `0e1ea254`; hosted source bytes still cannot be listed (management
list API 403). Do not invent a hosted blob SHA. Live Worker identity is
§1c and is distinct from this SPA origin SHA.

This is not a soak claim. This 270 attestation is not authorization to
apply 240 or flip `private_realtime_enabled`. The later `writes_enabled`
go is §3d. The later origin canary is §3e. Neither is soak-complete.

## 3c. Production daily backups — verified, no PITR

Verified 2026-09-02 ~10:26 ICT from the Lovable Cloud UI for project
`8f71f52d-c666-442f-bfb8-5f0a4e0ac1d5` / Supabase `onfzjmfjldsbthchssfr`.
Nothing was restored. At that 10:26 ICT read the row was
`writes_enabled=false`, `private_realtime_enabled=false`
(`capability_runtime_settings.updated_at` `2026-08-26 04:32:27 UTC`).
Same-day later go is §3d.

The authoritative backup panel is Lovable Cloud → More → Cloud → Database →
Backups. The supabase.com dashboard for this ref 404s from our session; do
not treat that 404 as "no backups."

There is no PITR / point-in-time UI on this project (Tiny instance, disk
0.47/2 GB). The cutover runbook's "PITR checkpoint" is not available here.
Recoverable backups are 14 daily automated snapshots, taken ~19:33–19:35 UTC
each day (~02:33 ICT the next calendar day). Latest listed:
`2026-09-01 19:33:22 UTC` (`2026-09-02 02:33 ICT`). Oldest listed:
`2026-08-19 19:34:43 UTC`. Each row is restore-only; there is no download and
no manual create-backup button. Nothing on that panel was clicked.

Worst-case loss on restore-to-snapshot is up to ~24h of writes. The live
write path is still legacy `NotePage`.

This backup-panel check is not a soak claim. This is not authorization to call
`capability_runtime_set`, flip `writes_enabled` or `private_realtime_enabled`,
origin-deploy, flip the canary, or apply SQL 240 — that 10:26 ICT verify was
not the go; the named later `writes_enabled` go is §3d; later origin canary is
§3e; neither is soak-complete or SQL 240.

## 3d. Production writes_enabled go — verified, Realtime still false

Verified 2026-09-02 against production Lovable Cloud project
`8f71f52d-c666-442f-bfb8-5f0a4e0ac1d5` / Supabase `onfzjmfjldsbthchssfr`.
Canonical origin remains `https://note.syrin.online/` (do not advertise `snote.lovable.app`).

Daily snapshot re-check 2026-09-02 ~11:23 ICT (Lovable Cloud → More → Cloud →
Database → Backups), production not staging: latest snapshot still
`2026-09-01 19:33:22 UTC` (`2026-09-02 02:33:22 ICT`). 14 daily automated
snapshots (oldest visible `2026-08-19 19:34:43 UTC`). No PITR / point-in-time
UI. Restore not clicked.

Named go: `SELECT public.capability_runtime_set(true, false);`
via Lovable Cloud `query_database`. Confirmed row:
`capability_runtime_settings` `singleton=true`, `writes_enabled=true`,
`private_realtime_enabled=false`, `updated_at`
`2026-09-02 04:24:07.235188+00` (11:24 ICT).

SQL 240 still not applied: `capability_note_import_legacy` is absent. At that
go, live SPA was still GET `https://note.syrin.online/version.json`
`deployedSha` `fe18302fb650b98eaee414e34e61db5cf06acc61`,
`capabilityRoutesEnabled` false, `builtAt` `2026-09-01T19:55:38.557Z`.
POST `/functions/v1/note-session` `{}` still 401 `{"error":"unauthorized"}`
no-store. Live write path is still legacy `NotePage`;
this flip does not mount `CutoverNotePage` and is not a canary.

This is not canary, not SQL 240, not origin/Worker deploy, not
`private_realtime_enabled`, and not soak.
Later origin canary is §3e.

## 3e. Production origin canary go — capabilityRoutesEnabled true

Verified 2026-09-02 ~12:01 ICT. Cloudflare Pages project `snote-g4-origin`
via `wrangler pages deploy` of a strict `build:release`. Build flags:
`VITE_CAPABILITY_ROUTES_ENABLED=true` only. `VITE_CAPABILITY_AUTH_ENABLED` and `VITE_ADMIN_PANEL_ENABLED` stayed false.

Canonical origin remains `https://note.syrin.online/` (do not advertise `snote.lovable.app`).

First canary origin (not current live) `version.json` at that go
(browser UA; `no-store`) on both
`https://note.syrin.online/version.json` and
`https://snote-g4-origin.pages.dev/version.json`:
`deployedSha` `c5914c8e8f953d5e8ed877d8c892b6e0941095e7`,
`capabilityRoutesEnabled` true, `builtAt` `2026-09-02T05:00:59.705Z`,
`buildId` `1788325246305-qzfta8za`.

Pages production deployment id `6277a076-c0d3-4464-b5b5-5b0432011029`
replaced previous production `fe18302f` / `32ccfc35`.

Same-canary origin SHA bump 2026-09-02 ~16:03 ICT (not current live): Pages
`snote-g4-origin` redeployed find/replace UI (#64+#65). `version.json` at
that bump (browser UA; `no-store`) on both canonical and Pages hosts:
`deployedSha` `386421e87f7eac2864f1a40655a2b0255b4332d6`,
`capabilityRoutesEnabled` true, `builtAt` `2026-09-02T09:02:48.606Z`,
`buildId` `1788339753769-8ld1rqzh`.
Pages production deployment id `09472051-c61c-4fcb-ace4-1561da6d4cc2`
replaced previous live origin `c5914c8e` / Pages `6277a076`.

Same-canary origin SHA bump 2026-09-02 ~17:52 ICT (not current live): Pages
`snote-g4-origin` redeployed find overlay top-right + markdown table preview
(#67). `version.json` at that bump (browser UA; `no-store`) on both
canonical and Pages hosts:
`deployedSha` `4baa89665ee1d75dcafb238d62fbed9b18f8a7c7`,
`capabilityRoutesEnabled` true, `builtAt` `2026-09-02T10:52:01.159Z`,
`buildId` `1788346307439-oyd5q3or`.
Pages production deployment id `a138549e-0c61-4e0c-83f2-366c341309a9`
replaced previous live origin `386421e8` / Pages `09472051`.

Same-canary origin SHA bump 2026-09-02 ~19:22 ICT (not current live): Pages
`snote-g4-origin` redeployed paste HTML copy-box no longer escapes `_` as
`\_` (#69). `version.json` at that bump (browser UA; `no-store`) on both
canonical and Pages hosts:
`deployedSha` `7335fadce1dc96ee5548deb2e7e75b2bbff57c40`,
`capabilityRoutesEnabled` true, `builtAt` `2026-09-02T12:22:26.889Z`,
`buildId` `1788351733291-8f4qsmpx`.
Pages production deployment id `86b91475-2b60-4c30-81e8-50b6a004a734`
replaced previous live origin `4baa8966` / Pages `a138549e`.

Same-canary origin SHA bump 2026-09-02 ~20:41 ICT (not current live): Pages
`snote-g4-origin` redeployed find overlay `position:fixed` and horizontally centered
(~50vw, clamped); Note dropdown removed (#71). `version.json` at that bump
(browser UA; `no-store`) on both canonical and Pages hosts:
`deployedSha` `8d9ce025d05c65664afaba78b9b145bf137edb83`,
`capabilityRoutesEnabled` true, `builtAt` `2026-09-02T13:40:14.339Z`,
`buildId` `1788356400749-1b51r8sg`.
Pages production deployment id `e3033d20-c0db-4a9d-95e4-e96abb459572`
replaced previous live origin `7335fadc` / Pages `86b91475`.

Same-canary origin SHA bump 2026-09-02 ~22:41 ICT: Pages `snote-g4-origin`
redeployed Phase 1 knowledge UX — `[[slug]]` and Obsidian-order
`[[slug|display]]`, client-only backlinks in outline, dotted dead links
(#73). Live
`version.json` (browser UA; `no-store`) on both canonical and Pages hosts:
`deployedSha` `e39caacd6b37518d61498262ba38506de64f5545`,
`capabilityRoutesEnabled` true, `builtAt` `2026-09-02T15:41:04.072Z`,
`buildId` `1788363650837-yre560cm`.
Pages production deployment id `005b2f9d`
replaces previous live origin `8d9ce025` / Pages `e3033d20`.

Kill switch unchanged: `writes_enabled=true`,
`private_realtime_enabled=false`, `updated_at`
`2026-09-02 04:24:07.235188+00` (see §3d). SQL 240 still not applied
(`capability_note_import_legacy` is absent).
POST `/functions/v1/legacy-note-open` `{}` still 410 `{"found":false}`.
POST `/functions/v1/note-session` `{}` still 401 `{"error":"unauthorized"}`.
Worker `syrin-prerender` still `9fcc58bc` / `b4d1a94e` — not redeployed.

This is dual-mode `NotePage` (`legacyOnly={!canary}`): plain slug still
legacy; `#owner`/`#edit` may open capability polling. Home still does not mint capabilities.
This is not SQL 240, not Realtime, not soak-complete.
Soak ≥48h started ~12:01 ICT from the first canary origin `c5914c8e`;
this bump does not restart soak. This is a same-canary origin SHA bump,
not soak-complete, not 240.

## 4. Public `notes` access — fixed by the cutover migration, not yet operationally proven

Production SQL 220 (see §3a) and SQL 270 (see §3b) do not change this: 240 is
still not applied.

`20260724000000_atomic_capability_cutover.sql` dynamically drops every policy
on `public.notes` and revokes all direct privileges from `PUBLIC`, `anon`, and
`authenticated` in one transaction. Capability, update, checkpoint, and share
tables remain default-deny. The SPA uses narrow Edge APIs. Git and production
`legacy-note-open` are a generic `410 no-store` tombstone rather than a notes
dump (see §1b).

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
A 2026-09-02 `package.json` override of `fast-uri` `^3.1.6` (resolved `3.1.7`, official registry integrity) clears [GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8), [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc), [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf), [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp), [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3), and [GHSA-58mr-gqgx-xq4g](https://github.com/advisories/GHSA-58mr-gqgx-xq4g). The override is the durable floor; the lockfile must not resolve below `3.1.6`.

## Scan triage rule

Treat any finding about deployed direct-table access, public Realtime,
content-bearing crawler output, raw token paths, or fail-open admin rate limits
as open until staging and production evidence proves otherwise. The repository
contains the intended fixes, but merge status is not deployment status.
