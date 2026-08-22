# G3 staging plan — split, fail-closed gates

Status: G2 closed at `f712a99c`. G3 planning starts from the docs-only
candidate `75c61c46`; the immutable staging SHA will be the final reviewed G3A
implementation head, not either historical SHA. The release remains NO-GO for
merge or deployment until the applicable gates below have passed.

No G3 step may use production data, the production Supabase project reference,
or a production hostname. No secret value may enter the repository, chat,
command output, logs, test artifacts, or evidence.

## G3A — repository readiness

G3A is the current, repository-only change:

- `VITE_CAPABILITY_ROUTES_ENABLED` activates existing capability note routes
  only when its exact build-time value is `true`; missing or malformed values
  preserve legacy-only routing;
- `bun run staging:prepare` requires clean Git-tracked Supabase sources, rejects
  ambient or linked state, and creates a disposable OS-temp workdir containing
  Edge Function sources plus an explicit allowlist of additive migrations;
- the generated config uses `snote-staging-local`; its manifest records the
  reviewed commit plus SHA-256 hashes for config, functions, and migrations;
- `20260724000000_atomic_capability_cutover.sql` is excluded.

G3A does not run Docker or the Supabase CLI, link a project, create an account,
generate a secret, deploy, merge PR #10, or mutate production. Its output is
readiness code and local test evidence, not staging evidence.

## G3B — local polling rehearsal

G3B requires separate owner approval. It is local-only and may start only when
the G3A head is reviewed, the worktree is clean, the Docker engine is healthy,
disk capacity is sufficient, and the exact `supabase@2.115.0` development
dependency is present in the frozen lockfile.
It creates no account and contacts no remote project.

### Workdir and migration procedure

Run from the reviewed checkout:

```powershell
bun run staging:prepare
$SupabaseCliVersion = (bunx --no-install supabase --version).Trim()
if ($SupabaseCliVersion -ne "2.115.0") { throw "Unexpected Supabase CLI version" }
bunx --no-install supabase --workdir "<generated-workdir>" start
bunx --no-install supabase --workdir "<generated-workdir>" db reset --local
```

`--workdir` is the Supabase global project-directory flag; `db reset --local`
recreates the local database and applies only migrations copied into that
generated directory. Never use the source checkout as the workdir and never use
an ambient linked project. Before any probe, verify all of the following:

- the manifest source commit equals the reviewed checkout HEAD;
- every manifest hash matches its generated config, function, or migration
  file, including all 22 allowlisted migrations;
- `20260724000000_atomic_capability_cutover.sql` must not appear in the
  generated workdir or migration ledger;
- the generated config contains `snote-staging-local`, while
  `onfzjmfjldsbthchssfr` must be rejected;
- the database ledger contains exactly the allowlisted timestamps in order;
- direct protected-table access is denied for both `anon` and `authenticated`.

### Runtime sequence

The additive migration initializes `writes=false, privateRealtime=false`.
Keep that state while proving API failure paths, protected-table denials, note-A
versus note-B isolation, and service-role-only runtime controls. Only after those
checks pass may the local test window call `capability_runtime_set(true, false)`,
which yields `writes=true, privateRealtime=false`.

Before building the local SPA, set all four values in the current PowerShell
process; never rely on the committed `.env` fallback:

```powershell
$env:VITE_CAPABILITY_ROUTES_ENABLED = "true"
$env:VITE_SUPABASE_PROJECT_ID = "snote-staging-local"
$env:VITE_SUPABASE_URL = "<local API URL from the generated stack>"
$env:VITE_SUPABASE_PUBLISHABLE_KEY = "<local publishable key from the same stack>"
bun run build:check
$ProductionProjectRef = "onfzjmfjldsbthchssfr"
if (Get-ChildItem dist -Recurse -File | Select-String -SimpleMatch $ProductionProjectRef -Quiet) {
  throw "Production Supabase reference found in the staging artifact"
}
```

The build itself fails closed if capability routes resolve to the production
project ID or canonical production Supabase hostname. Keep managed Auth disabled
so the API returns polling sessions. G3B may claim only:

- owner/edit/view scope isolation and cross-note denial;
- idempotent replay, reversed/concurrent saves, and checkpoint conflict codes;
- encrypted round-trip and locked-note plaintext exclusion;
- IndexedDB outbox acknowledgement, reconnect, reopen, and navigation under
  800 ms without losing an update;
- revoke/rotate behavior, oversized-update quarantine, and legacy exact-match
  read-only access;
- stalled PWA update retains the active offline application.

The private Realtime path is out of scope for G3B. On any failure and again
during normal teardown, return to `false,false`, record the terminal state, stop
the generated local stack with its explicit workdir, and retain only redacted
evidence. Delete the disposable workdir after its manifest and results have been
reviewed.

## G3C — hosted staging

G3C requires separate owner approval. It creates an isolated staging Supabase
project and staging-only Cloudflare endpoint. Production data, credentials,
hostnames, DNS routes, and the production project ref remain forbidden.

### Auth, Realtime, and runtime

Hosted staging must enable and prove anonymous Auth, a staging Turnstile site
key, `VITE_CAPABILITY_AUTH_ENABLED=true`, and the same exact capability-route
flag. The private Realtime path may be enabled only after polling passes and
five-minute JWT issuance/refresh, private-channel RLS, membership cleanup, and
redacted logging are verified. Failure returns runtime state to `false,false`;
it never falls back by opening public Realtime.

### Functions and gateway boundary

Before deploy, write a desired-state table for every committed Edge Function.
Each row must state deployed/tombstoned/omitted, source hash, deployed version,
route exposure, and `verify_jwt` mode. The inventory must explicitly decide
`raw` and `share-revoke`; no function inherits an assumed gateway setting.

Client-supplied forwarding headers must be tested through the real gateway for
both admin login and capability note create/import. Continue only when the
gateway overwrites spoofed values with one valid address literal. Otherwise
those admission paths remain fail-closed with `503`.

### Synthetic data and recovery

Normal fixtures use public APIs. Exceptional legacy and quarantine fixtures may
use a reviewed staging-only SQL/service-role seed whose provenance, assertions,
and cleanup are recorded. No production backup is imported.

Free-tier recovery uses a manual logical dump, checksum, restore rehearsal, and
post-restore core probes. The procedure must separately account for anonymous
Auth users needed by the Realtime test. Do not claim recovery until the restored
project reproduces the expected ledger, runtime state, users, and probe results.

### Edge containment and immutable evidence

The staging Worker must use a non-redirecting staging origin and prove generic
`no-store`/`noindex` crawler responses, analytics-path denial, cache purge, and
logs without content, ciphertext, slug, token, fragment, private path, or raw
IP. The final evidence bundle records:

- SPA source SHA and build ID;
- Edge Function source hashes and deployed versions;
- Worker deployment ID, routes, and config hash;
- generated-file SHA-256 hashes plus the applied migration ledger;
- staging project ref and region;
- runtime flags and Auth mode, Turnstile mode, JWT lifetime, and Realtime mode;
- gateway overwrite, API, browser, rollback, and restore results;
- a final redaction scan over every shareable artifact.

The evidence bundle uses synthetic opaque fixture labels and contains no secret
or private value. Independent review of the exact bundle and exact deployed SHA
is required before G3 can close.

## Hard stops after G3

G3 does not authorize atomic cutover, production deployment, PR #10 merge,
production table revocation, production cache purge, or the 48-hour production
soak. Those remain later gates with their own backup and rollback checkpoints.
